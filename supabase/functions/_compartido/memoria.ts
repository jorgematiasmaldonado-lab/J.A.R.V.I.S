// =====================================================================
// J.A.R.V.I.S. · Memoria de largo plazo y perfil
// Autor: Maldonado Jorge Matias
//
// - Nunca se guardan contraseñas, tarjetas, documentos, CBU ni claves:
//   motivoProhibido() lo detecta y el servidor lo rechaza, aunque el
//   modelo lo intente.
// - El vector se calcula sobre el texto SEUDONIMIZADO.
// - Si ya existe un recuerdo casi igual, se actualiza en vez de duplicar.
// =====================================================================

import { admin } from "./seguridad.ts";
import type { Seudonimizador } from "./seudonimizar.ts";
import { type ProveedorEmbeddings, vectorTexto } from "./llm/embeddings.ts";

export const CATEGORIAS = ["persona", "proyecto", "preferencia", "dato"] as const;
export type Categoria = typeof CATEGORIAS[number];

/** Parecido a partir del cual un recuerdo nuevo se considera repetido. */
const UMBRAL_DUPLICADO = 0.92;

export class ErrorMemoria extends Error {}

// ---------------------------------------------------------------------
// Datos que nunca se guardan
// ---------------------------------------------------------------------
function pasaLuhn(digitos: string): boolean {
  let suma = 0;
  let doble = false;
  for (let i = digitos.length - 1; i >= 0; i--) {
    let d = Number(digitos[i]);
    if (doble) { d *= 2; if (d > 9) d -= 9; }
    suma += d;
    doble = !doble;
  }
  return suma % 10 === 0;
}

const PROHIBIDOS: { motivo: string; prueba: (t: string) => boolean }[] = [
  {
    motivo: "parece un número de tarjeta",
    prueba: (t) => [...t.matchAll(/(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g)].some((m) => pasaLuhn(m[0].replace(/\D/g, ""))),
  },
  { motivo: "parece un CBU o CVU", prueba: (t) => /(?<!\d)\d{22}(?!\d)/.test(t.replace(/[ -]/g, "")) },
  { motivo: "parece un CUIL o CUIT", prueba: (t) => /\b(?:20|23|24|25|26|27|30|33|34)-?\d{8}-?\d\b/.test(t) },
  {
    motivo: "parece un número de documento",
    prueba: (t) => /\b\d{1,2}\.\d{3}\.\d{3}\b/.test(t) && !/\$\s*\d{1,2}\.\d{3}\.\d{3}/.test(t) ||
      /\b(?:dni|d\.n\.i\.|documento|pasaporte)\b[^0-9]{0,15}\d{6,9}/i.test(t),
  },
  {
    motivo: "parece una contraseña, PIN o código de seguridad",
    prueba: (t) =>
      /(?<!\p{L})(?:contraseñas?|password|passwd|pass|pin|cvv|cvc|clave)(?!\p{L})\s*(?::|=|\bes\b|\b(?:de|del|de la)\b[^.]{0,40}?(?::|=|\bes\b))\s*\S+/iu
        .test(t),
  },
  {
    motivo: "parece una clave de API o un token",
    prueba: (t) =>
      /AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9_-]{20,}|sb_secret_|sbp_[0-9a-f]{20,}|gh[pousr]_[0-9A-Za-z]{20,}|github_pat_|\d{8,10}:AA[0-9A-Za-z_-]{30,}|eyJ[0-9A-Za-z_-]{10,}\.eyJ/
        .test(t),
  },
  { motivo: "contiene un documento protegido", prueba: (t) => /\[(?:DNI|CUIL)_\d+\]/.test(t) },
];

/** Devuelve el motivo si el texto tiene un dato que no se guarda, o null. */
export function motivoProhibido(texto: string): string | null {
  for (const p of PROHIBIDOS) if (p.prueba(texto)) return p.motivo;
  return null;
}

// ---------------------------------------------------------------------
// Operaciones
// ---------------------------------------------------------------------
export interface DepsMemoria {
  userId: string;
  seud: Seudonimizador;
  emb: ProveedorEmbeddings;
  canal: string;
  /** Control de cupo antes de cada llamada de embeddings. */
  contarEmb?: () => Promise<void>;
}

export interface Recuerdo {
  id: number;
  texto: string;
  categoria: string;
  creado: string;
  similitud?: number;
}

async function calcularVector(d: DepsMemoria, texto: string, tipo: "documento" | "consulta"): Promise<string> {
  await d.contarEmb?.();
  return vectorTexto(await d.emb.vector(d.seud.ocultar(texto), tipo));
}

function limpiar(texto: string): string {
  return texto.replace(/\s+/g, " ").trim();
}

export async function guardarMemoria(
  d: DepsMemoria, op: { texto: string; categoria: Categoria; fuente: "chat" | "manual" },
): Promise<{ id: number; accion: "creada" | "actualizada" }> {
  const texto = limpiar(op.texto);
  if (texto.length < 3) throw new ErrorMemoria("el recuerdo está vacío");
  const motivo = motivoProhibido(texto);
  if (motivo) throw new ErrorMemoria(`no lo guardo por seguridad: ${motivo}`);

  const vector = await calcularVector(d, texto, "documento");
  const { data: parecidos, error: e1 } = await admin().rpc("buscar_memorias", {
    p_user: d.userId, p_embedding: vector, p_limite: 1, p_umbral: UMBRAL_DUPLICADO,
  });
  if (e1) throw new Error("buscar_memorias: " + e1.message);

  const ahora = new Date().toISOString();
  if (parecidos?.length) {
    const id = parecidos[0].id as number;
    const { error } = await admin().from("memorias")
      .update({ texto, categoria: op.categoria, embedding: vector, actualizado: ahora })
      .eq("id", id).eq("user_id", d.userId);
    if (error) throw new Error("actualizar memoria: " + error.message);
    return { id, accion: "actualizada" };
  }
  const { data, error } = await admin().from("memorias")
    .insert({ user_id: d.userId, texto, categoria: op.categoria, embedding: vector, fuente: op.fuente, canal: d.canal })
    .select("id").single();
  if (error) throw new Error("guardar memoria: " + error.message);
  return { id: data.id, accion: "creada" };
}

export async function editarMemoria(d: DepsMemoria, op: { id: number; texto: string; categoria: Categoria }): Promise<void> {
  const texto = limpiar(op.texto);
  const motivo = motivoProhibido(texto);
  if (motivo) throw new ErrorMemoria(`no lo guardo por seguridad: ${motivo}`);
  const { data: existe } = await admin().from("memorias").select("id").eq("id", op.id).eq("user_id", d.userId).maybeSingle();
  if (!existe) throw new ErrorMemoria("ese recuerdo no existe");
  const vector = await calcularVector(d, texto, "documento");
  const { error } = await admin().from("memorias")
    .update({ texto, categoria: op.categoria, embedding: vector, actualizado: new Date().toISOString() })
    .eq("id", op.id).eq("user_id", d.userId);
  if (error) throw new Error("editar memoria: " + error.message);
}

export async function buscarMemorias(
  d: DepsMemoria, consulta: string, limite = 5, umbral = 0.6,
): Promise<Recuerdo[]> {
  const vector = await calcularVector(d, consulta, "consulta");
  const { data, error } = await admin().rpc("buscar_memorias", {
    p_user: d.userId, p_embedding: vector, p_limite: limite, p_umbral: umbral,
  });
  if (error) throw new Error("buscar_memorias: " + error.message);
  return (data ?? []) as Recuerdo[];
}

export async function borrarMemorias(userId: string, ids: number[]): Promise<number> {
  if (!ids.length) return 0;
  const { data, error } = await admin().from("memorias").delete().eq("user_id", userId).in("id", ids).select("id");
  if (error) throw new Error("borrar memorias: " + error.message);
  return data?.length ?? 0;
}

// ---------------------------------------------------------------------
// Perfil
// ---------------------------------------------------------------------
export async function leerPerfil(userId: string): Promise<string> {
  const { data } = await admin().from("perfil").select("texto").eq("user_id", userId).maybeSingle();
  return data?.texto ?? "";
}

export async function guardarPerfil(userId: string, texto: string): Promise<void> {
  const limpio = texto.trim().slice(0, 2000);
  const motivo = motivoProhibido(limpio);
  if (motivo) throw new ErrorMemoria(`no lo guardo por seguridad: ${motivo}`);
  const { error } = await admin().from("perfil")
    .upsert({ user_id: userId, texto: limpio, actualizado: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) throw new Error("guardar perfil: " + error.message);
}

// ---------------------------------------------------------------------
// Contexto para el modelo (se seudonimiza después, en el agente)
// ---------------------------------------------------------------------
export function contextoMemoria(perfil: string, recuerdos: Recuerdo[], zona: string): string {
  const partes: string[] = [];
  if (perfil.trim()) partes.push(`<perfil>\n${perfil.trim()}\n</perfil>`);
  if (recuerdos.length) {
    const fecha = (s: string) => {
      try { return new Date(s).toLocaleDateString("es-AR", { timeZone: zona }); } catch { return s.slice(0, 10); }
    };
    partes.push(
      "<recuerdos>\n" + recuerdos.map((r) => `- (${r.categoria}, ${fecha(r.creado)}) ${r.texto}`).join("\n") + "\n</recuerdos>",
    );
  }
  return partes.join("\n");
}
