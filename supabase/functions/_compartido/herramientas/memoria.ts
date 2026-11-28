// =====================================================================
// J.A.R.V.I.S. · Herramientas de memoria
// Autor: Maldonado Jorge Matias
//
//   guardar_memoria  (escritura)  "Tomo nota, señor"
//   buscar_memorias  (lectura)    "¿Qué sabés de X?"
//   olvidar_memoria  (sensible)   "Olvidá X" → tarjeta Confirmar / Cancelar
// =====================================================================

import { buscarMemorias, CATEGORIAS, type Categoria, type DepsMemoria, ErrorMemoria, guardarMemoria } from "../memoria.ts";
import type { Contexto, Herramienta } from "./tipos.ts";

/** Parecido mínimo para considerar que un recuerdo habla de lo pedido. */
const umbralBusqueda = () => Number(Deno.env.get("MEMORIA_UMBRAL") ?? 0.6);

function deps(ctx: Contexto): DepsMemoria {
  if (!ctx.emb) throw new ErrorMemoria("la memoria no está disponible (falta configurar los embeddings)");
  return { userId: ctx.userId, seud: ctx.seud, emb: ctx.emb, canal: ctx.canal, contarEmb: ctx.contarEmb };
}

export const guardarRecuerdo: Herramienta = {
  nombre: "guardar_memoria",
  descripcion: "Guarda en la memoria de largo plazo un dato duradero e importante sobre el usuario, su gente, sus " +
    "proyectos o sus preferencias. Una sola idea por recuerdo, en tercera persona y autocontenida " +
    "(ej.: 'El jefe del usuario es [PERSONA_3]'). Nunca contraseñas, tarjetas, documentos ni claves.",
  nivel: "escritura",
  estado: "ARCHIVANDO EN MEMORIA",
  parametros: {
    type: "object",
    properties: {
      texto: { type: "string", minLength: 3, maxLength: 500, description: "El recuerdo, autocontenido." },
      categoria: { type: "string", enum: [...CATEGORIAS], description: "persona, proyecto, preferencia o dato." },
    },
    required: ["texto", "categoria"],
  },
  async ejecutar(args, ctx) {
    const r = await guardarMemoria(deps(ctx), {
      texto: args.texto as string, categoria: args.categoria as Categoria, fuente: "chat",
    });
    return { guardado: true, accion: r.accion };
  },
};

export const buscarRecuerdos: Herramienta = {
  nombre: "buscar_memorias",
  descripcion: "Busca en la memoria de largo plazo lo que se sabe sobre un tema o persona. Usala cuando el usuario " +
    "pregunte '¿qué sabés de…?', '¿te acordás…?' o cuando necesites un dato que pudo haber contado antes.",
  nivel: "lectura",
  estado: "CONSULTANDO MEMORIA",
  parametros: {
    type: "object",
    properties: {
      consulta: { type: "string", minLength: 2, maxLength: 300, description: "Tema o persona a buscar." },
      limite: { type: "integer", minimum: 1, maximum: 10, description: "Cantidad máxima de recuerdos (por defecto 5)." },
    },
    required: ["consulta"],
  },
  async ejecutar(args, ctx) {
    const recuerdos = await buscarMemorias(deps(ctx), args.consulta as string, (args.limite as number) ?? 5, umbralBusqueda() - 0.05);
    if (!recuerdos.length) return { recuerdos: [], nota: "No hay recuerdos sobre eso." };
    return { recuerdos: recuerdos.map((r) => ({ texto: r.texto, categoria: r.categoria, fecha: r.creado.slice(0, 10) })) };
  },
};

export const olvidarRecuerdo: Herramienta = {
  nombre: "olvidar_memoria",
  descripcion: "Prepara el borrado de los recuerdos sobre un tema cuando el usuario pide olvidar algo. NO borra: " +
    "deja una tarjeta para que el usuario confirme en la pantalla.",
  nivel: "sensible",
  estado: "BUSCANDO QUÉ OLVIDAR",
  parametros: {
    type: "object",
    properties: {
      consulta: { type: "string", minLength: 2, maxLength: 300, description: "Qué hay que olvidar." },
    },
    required: ["consulta"],
  },
  async proponer(args, ctx) {
    const recuerdos = await buscarMemorias(deps(ctx), args.consulta as string, 5, umbralBusqueda());
    if (!recuerdos.length) return { nada: "No encontré recuerdos sobre eso." };
    const n = recuerdos.length;
    return {
      tipo: "olvidar_memorias",
      resumen: `Olvidar ${n} ${n === 1 ? "recuerdo" : "recuerdos"} sobre "${(args.consulta as string).slice(0, 80)}"`,
      detalle: recuerdos.map((r) => r.texto),
      datos: { ids: recuerdos.map((r) => r.id) },
    };
  },
};
