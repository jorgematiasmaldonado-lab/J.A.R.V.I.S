// =====================================================================
// J.A.R.V.I.S. · Una conversación completa, igual para todos los canales
// Autor: Maldonado Jorge Matias
//
// La usan jarvis-chat (web, con streaming) y jarvis-telegram. Hace:
//   1. Cargar ajustes, nombres protegidos e historial (compartido entre canales).
//   2. Controlar el cupo.
//   3. Traer perfil y recuerdos relevantes.
//   4. Correr el agente con las herramientas.
//   5. Guardar la conversación y registrar la actividad.
// =====================================================================

import { ejecutarAgente, type MensajeGuardado } from "./agente.ts";
import { declaraciones, ejecutarHerramienta, estadoDe } from "./herramientas/index.ts";
import { AJUSTES_POR_DEFECTO, type Ajustes, COLUMNAS_AJUSTES, type Contexto } from "./herramientas/tipos.ts";
import type { AccionPendiente } from "./confirmaciones.ts";
import { crearEmbeddings } from "./llm/embeddings.ts";
import { capaGemini, crearProveedor, ErrorLLM } from "./llm/index.ts";
import { buscarMemorias, contextoMemoria, leerPerfil, type Recuerdo } from "./memoria.ts";
import { promptSistema } from "./prompt.ts";
import { admin, config, consumirCupo, registrarActividad } from "./seguridad.ts";
import { type EntradaSeudonimo, Seudonimizador } from "./seudonimizar.ts";

const MENSAJES_DE_CONTEXTO = 20;
const RECUERDOS_POR_MENSAJE = 5;

export class ErrorCupo extends Error {}

/** Errores que se pueden mostrar tal cual al usuario. */
export class ErrorConversacion extends Error {
  constructor(public codigo: "limite" | "error_base" | "modelo", mensaje: string) { super(mensaje); }
}

export interface Preparada {
  userId: string;
  canal: string;
  ajustes: Ajustes;
  seud: Seudonimizador;
  historial: MensajeGuardado[];
}

/** Paso previo (rápido): datos del usuario y control de cupo. Lanza ErrorConversacion. */
export async function prepararConversacion(userId: string, canal: string): Promise<Preparada> {
  const db = admin();
  const [{ data: aj, error: e1 }, { data: lista, error: e2 }, { data: hist, error: e3 }] = await Promise.all([
    db.from("ajustes").select(COLUMNAS_AJUSTES).eq("user_id", userId).maybeSingle(),
    db.from("seudonimos").select("id, tipo, valor, alias").eq("user_id", userId),
    db.from("mensajes").select("rol, contenido").eq("user_id", userId).order("id", { ascending: false }).limit(MENSAJES_DE_CONTEXTO),
  ]);
  for (const e of [e1, e2, e3]) if (e) console.error("Error leyendo datos del usuario:", e.message);
  // Sin la lista de nombres protegidos no se puede proteger a terceros: mejor no responder
  if (e2) throw new ErrorConversacion("error_base", "no pude leer la lista de nombres protegidos");
  const ajustes: Ajustes = { ...AJUSTES_POR_DEFECTO, ...(aj ?? {}) };

  const cupo = await consumirCupo(userId, "peticion", config.limiteMinuto, config.limiteDia, ajustes.zona_horaria);
  if (!cupo.permitido) {
    await registrarActividad(userId, { tipo: "limite", ok: false, canal, parametros: cupo });
    throw new ErrorConversacion("limite", "recibí demasiadas consultas seguidas; deme un momento");
  }
  return {
    userId, canal, ajustes,
    seud: new Seudonimizador((lista ?? []) as EntradaSeudonimo[]),
    historial: ((hist ?? []) as MensajeGuardado[]).reverse(),
  };
}

export interface OpcionesConversacion {
  mensaje: string;
  ubicacion?: { lat: number; lon: number };
  onEstado?: (texto: string) => void;
  onTexto?: (delta: string) => void;
  onConfirmacion?: (accion: AccionPendiente) => void;
}

/** Corre la conversación. Lanza ErrorConversacion("modelo") con un mensaje apto para mostrar. */
export async function conversar(p: Preparada, op: OpcionesConversacion): Promise<{ texto: string; aviso: string | null }> {
  const { userId, canal, ajustes, seud } = p;
  const zona = ajustes.zona_horaria;
  const mensaje = op.mensaje.trim();
  const inicio = Date.now();
  let llmHoy = 0;

  const emb = crearEmbeddings();
  const contarEmb = async () => {
    const c = await consumirCupo(userId, "emb", 60, config.limiteEmbDia, zona);
    if (!c.permitido) throw new ErrorCupo("alcanzamos el tope diario de consultas a la memoria");
  };
  const ctx: Contexto = {
    userId, canal, ajustes, ubicacion: op.ubicacion, seud, emb, contarEmb, onConfirmacion: op.onConfirmacion,
  };

  try {
    // Memoria: el perfil siempre, y los recuerdos parecidos al mensaje.
    // Si falla (cupo, red), Jarvis responde igual, sin recuerdos.
    let recuerdos: Recuerdo[] = [];
    if (emb) {
      try {
        recuerdos = await buscarMemorias(
          { userId, seud, emb, canal, contarEmb }, mensaje, RECUERDOS_POR_MENSAJE, Number(Deno.env.get("MEMORIA_UMBRAL") ?? 0.6),
        );
      } catch (e) {
        console.error("Sin recuerdos para este mensaje:", (e as Error).message);
      }
    }
    const perfil = await leerPerfil(userId);

    const resultado = await ejecutarAgente({
      proveedor: crearProveedor(),
      seud,
      sistema: promptSistema({ nombreTrato: ajustes.nombre_trato, zonaHoraria: zona, canal, googleConectado: ajustes.google_conectado }),
      contexto: contextoMemoria(perfil, recuerdos, zona),
      historial: p.historial,
      mensaje,
      herramientas: declaraciones(),
      ejecutar: (nombre, args) => ejecutarHerramienta(nombre, args, ctx),
      estadoDe,
      antesDeLlamar: async () => {
        const c = await consumirCupo(userId, "llm", 60, config.limiteLlmDia, zona);
        llmHoy = c.dia;
        if (!c.permitido) throw new ErrorCupo("alcanzamos el tope diario de consultas al modelo que usted configuró");
      },
      onEstado: op.onEstado,
      onTexto: op.onTexto,
    });

    const texto = resultado.texto || `Hecho, ${ajustes.nombre_trato}.`;

    // Guardar la conversación (datos reales: quedan solo en su base, con RLS)
    const { error } = await admin().from("mensajes").insert([
      { user_id: userId, rol: "user", contenido: mensaje.slice(0, 8000), canal },
      { user_id: userId, rol: "model", contenido: texto.slice(0, 8000), canal },
    ]);
    if (error) console.error("No se guardó la conversación:", error.message);

    await registrarActividad(userId, {
      tipo: "chat", canal, ok: true,
      parametros: {
        largo_mensaje: mensaje.length,
        pasos: resultado.pasos,
        llamadas_llm: resultado.llamadasLlm,
        herramientas: resultado.herramientasUsadas,
        recuerdos_usados: recuerdos.length,
        datos_seudonimizados: seud.reemplazos,
        capa: capaGemini(),
        ms: Date.now() - inicio,
      },
    });

    const aviso = llmHoy >= config.limiteLlmDia * 0.8 ? `Lleva ${llmHoy} de ${config.limiteLlmDia} consultas al modelo hoy.` : null;
    return { texto, aviso };
  } catch (e) {
    let mensajeError = "tuve un inconveniente interno";
    if (e instanceof ErrorLLM || e instanceof ErrorCupo) mensajeError = e.message;
    else console.error(e);
    await registrarActividad(userId, { tipo: "chat", canal, ok: false, resultado: { error: mensajeError } });
    throw new ErrorConversacion("modelo", mensajeError);
  }
}
