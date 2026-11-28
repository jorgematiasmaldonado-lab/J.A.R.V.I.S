// =====================================================================
// J.A.R.V.I.S. · Herramientas de organización: tareas, proyectos y recordatorios
// Autor: Maldonado Jorge Matias
//
//   crear_tarea · listar_tareas · completar_tarea      (escritura / lectura)
//   borrar_tarea                                       (sensible → tarjeta)
//   crear_proyecto · listar_proyectos                  (escritura / lectura)
//   crear_recordatorio · listar_recordatorios          (escritura / lectura)
//   cancelar_recordatorio                              (sensible → tarjeta)
// =====================================================================

import { limiteComun, primerAviso } from "../avisos.ts";
import { coincidencias, mejorUnico } from "../coincidencias.ts";
import { ErrorMemoria, motivoProhibido } from "../memoria.ts";
import { admin } from "../seguridad.ts";
import { describirCuando, hoyLocal, localAUtc } from "../tiempo.ts";
import type { Contexto, Herramienta } from "./tipos.ts";

const PRIORIDADES: Record<string, number> = { alta: 1, normal: 2, baja: 3 };
const NOMBRE_PRIORIDAD = ["", "alta", "normal", "baja"];

function verificarTexto(...textos: (string | undefined)[]): void {
  for (const t of textos) {
    const m = t ? motivoProhibido(t) : null;
    if (m) throw new ErrorMemoria(`no lo guardo por seguridad: ${m}`);
  }
}

function horarios(ctx: Contexto) {
  return { zona: ctx.ajustes.zona_horaria, noMolestarDesde: ctx.ajustes.no_molestar_desde, noMolestarHasta: ctx.ajustes.no_molestar_hasta };
}

interface Proyecto { id: number; nombre: string; alias: string[] | null; cliente: string | null; prioridad: number; estado: string }

async function proyectosDe(userId: string): Promise<Proyecto[]> {
  const { data, error } = await admin().from("proyectos").select("id, nombre, alias, cliente, prioridad, estado").eq("user_id", userId);
  if (error) throw new Error("proyectos: " + error.message);
  return (data ?? []) as Proyecto[];
}

/** Busca un proyecto por nombre o alias ("ETAC", "gestión de personal"). */
async function buscarProyecto(userId: string, nombre: string): Promise<Proyecto | null> {
  const lista = await proyectosDe(userId);
  return mejorUnico(lista, (p) => [p.nombre, ...(p.alias ?? [])].join(" · "), nombre);
}

// =====================================================================
// TAREAS
// =====================================================================
interface Tarea { id: number; titulo: string; vence: string | null; prioridad: number; estado: string; proyecto_id: number | null }

async function tareasPendientes(userId: string): Promise<Tarea[]> {
  const { data, error } = await admin().from("tareas").select("id, titulo, vence, prioridad, estado, proyecto_id")
    .eq("user_id", userId).eq("estado", "pendiente").order("vence", { ascending: true, nullsFirst: false }).limit(200);
  if (error) throw new Error("tareas: " + error.message);
  return (data ?? []) as Tarea[];
}

export const crearTarea: Herramienta = {
  nombre: "crear_tarea",
  descripcion: "Anota una tarea pendiente del usuario.",
  nivel: "escritura",
  estado: "ANOTANDO TAREA",
  parametros: {
    type: "object",
    properties: {
      titulo: { type: "string", minLength: 2, maxLength: 300, description: "Qué hay que hacer, breve." },
      vence: { type: "string", maxLength: 10, description: "Fecha límite AAAA-MM-DD (opcional)." },
      prioridad: { type: "string", enum: ["alta", "normal", "baja"] },
      proyecto: { type: "string", maxLength: 80, description: "Nombre o alias del proyecto (opcional)." },
      notas: { type: "string", maxLength: 1000 },
    },
    required: ["titulo"],
  },
  async ejecutar(a, ctx) {
    verificarTexto(a.titulo as string, a.notas as string | undefined);
    let proyectoId: number | null = null;
    if (a.proyecto) {
      const p = await buscarProyecto(ctx.userId, a.proyecto as string);
      if (!p) return { error: `No encontré el proyecto "${a.proyecto}". Puedo crearlo con crear_proyecto si el usuario quiere.` };
      proyectoId = p.id;
    }
    const vence = a.vence ? localAUtc(a.vence as string, ctx.ajustes.zona_horaria) && (a.vence as string) : null;
    const { error } = await admin().from("tareas").insert({
      user_id: ctx.userId, titulo: (a.titulo as string).trim(), notas: (a.notas as string) ?? null, proyecto_id: proyectoId,
      vence, prioridad: PRIORIDADES[(a.prioridad as string) ?? "normal"], canal: ctx.canal,
    });
    if (error) throw new Error("crear tarea: " + error.message);
    return { creada: true, titulo: a.titulo, vence, proyecto: a.proyecto ?? null };
  },
};

export const listarTareas: Herramienta = {
  nombre: "listar_tareas",
  descripcion: "Lista las tareas del usuario.",
  nivel: "lectura",
  estado: "REVISANDO TAREAS",
  parametros: {
    type: "object",
    properties: {
      filtro: { type: "string", enum: ["pendientes", "hoy", "vencidas", "hechas"], description: "Por defecto, pendientes." },
      proyecto: { type: "string", maxLength: 80 },
    },
  },
  async ejecutar(a, ctx) {
    const hoy = hoyLocal(ctx.ajustes.zona_horaria);
    let q = admin().from("tareas").select("id, titulo, vence, prioridad, estado, proyecto_id, completada").eq("user_id", ctx.userId);
    const filtro = (a.filtro as string) ?? "pendientes";
    if (filtro === "hechas") q = q.eq("estado", "hecha").order("completada", { ascending: false });
    else {
      q = q.eq("estado", "pendiente").order("vence", { ascending: true, nullsFirst: false });
      if (filtro === "hoy") q = q.lte("vence", hoy);
      if (filtro === "vencidas") q = q.lt("vence", hoy);
    }
    if (a.proyecto) {
      const p = await buscarProyecto(ctx.userId, a.proyecto as string);
      if (!p) return { error: `No encontré el proyecto "${a.proyecto}".` };
      q = q.eq("proyecto_id", p.id);
    }
    const { data, error } = await q.limit(30);
    if (error) throw new Error("listar tareas: " + error.message);
    const proyectos = new Map((await proyectosDe(ctx.userId)).map((p) => [p.id, p.nombre]));
    return {
      hoy,
      tareas: (data ?? []).map((t) => ({
        titulo: t.titulo, vence: t.vence, vencida: !!t.vence && t.vence < hoy && t.estado === "pendiente",
        prioridad: NOMBRE_PRIORIDAD[t.prioridad], proyecto: t.proyecto_id ? proyectos.get(t.proyecto_id) ?? null : null,
      })),
    };
  },
};

export const completarTarea: Herramienta = {
  nombre: "completar_tarea",
  descripcion: "Marca como hecha una tarea pendiente, buscándola por su descripción ('ya hice lo del seguro').",
  nivel: "escritura",
  estado: "ACTUALIZANDO TAREAS",
  parametros: {
    type: "object",
    properties: { tarea: { type: "string", minLength: 2, maxLength: 300, description: "Cómo la nombró el usuario." } },
    required: ["tarea"],
  },
  async ejecutar(a, ctx) {
    const lista = await tareasPendientes(ctx.userId);
    const t = mejorUnico(lista, (x) => x.titulo, a.tarea as string);
    if (!t) {
      const parecidas = coincidencias(lista, (x) => x.titulo, a.tarea as string).slice(0, 5).map((x) => x.titulo);
      return parecidas.length
        ? { error: "Hay varias tareas parecidas; preguntá cuál.", candidatas: parecidas }
        : { error: "No encontré una tarea pendiente con esa descripción." };
    }
    const { error } = await admin().from("tareas").update({ estado: "hecha", completada: new Date().toISOString(), actualizado: new Date().toISOString() })
      .eq("id", t.id).eq("user_id", ctx.userId);
    if (error) throw new Error("completar tarea: " + error.message);
    return { completada: t.titulo };
  },
};

export const borrarTarea: Herramienta = {
  nombre: "borrar_tarea",
  descripcion: "Prepara el borrado de una o más tareas. NO borra: deja una tarjeta para que el usuario confirme.",
  nivel: "sensible",
  estado: "BUSCANDO TAREAS",
  parametros: {
    type: "object",
    properties: { tarea: { type: "string", minLength: 2, maxLength: 300 } },
    required: ["tarea"],
  },
  async proponer(a, ctx) {
    const { data } = await admin().from("tareas").select("id, titulo, estado").eq("user_id", ctx.userId).limit(300);
    const elegidas = coincidencias((data ?? []) as Tarea[], (x) => x.titulo, a.tarea as string).slice(0, 5);
    if (!elegidas.length) return { nada: "No encontré tareas con esa descripción." };
    return {
      tipo: "borrar_tareas",
      resumen: `Borrar ${elegidas.length === 1 ? "1 tarea" : `${elegidas.length} tareas`}`,
      detalle: elegidas.map((t) => t.titulo + (t.estado === "hecha" ? " (hecha)" : "")),
      datos: { ids: elegidas.map((t) => t.id) },
    };
  },
};

// =====================================================================
// PROYECTOS
// =====================================================================
export const crearProyecto: Herramienta = {
  nombre: "crear_proyecto",
  descripcion: "Registra un proyecto del usuario, con apodos para reconocerlo.",
  nivel: "escritura",
  estado: "REGISTRANDO PROYECTO",
  parametros: {
    type: "object",
    properties: {
      nombre: { type: "string", minLength: 2, maxLength: 80 },
      alias: { type: "array", maxItems: 8, items: { type: "string", minLength: 2, maxLength: 60 }, description: "Otras formas de nombrarlo." },
      cliente: { type: "string", maxLength: 80 },
      prioridad: { type: "string", enum: ["alta", "normal", "baja"] },
      repo: { type: "string", maxLength: 120, description: "Repositorio de GitHub dueño/nombre (opcional)." },
    },
    required: ["nombre"],
  },
  async ejecutar(a, ctx) {
    verificarTexto(a.nombre as string, a.cliente as string | undefined);
    const repo = (a.repo as string | undefined)?.trim();
    if (repo && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return { error: "El repositorio debe tener la forma dueño/nombre." };
    const { error } = await admin().from("proyectos").insert({
      user_id: ctx.userId, nombre: (a.nombre as string).trim(), alias: (a.alias as string[]) ?? [], cliente: (a.cliente as string) ?? null,
      prioridad: PRIORIDADES[(a.prioridad as string) ?? "normal"], repo: repo || null,
    });
    if (error?.code === "23505") return { error: "Ya existe un proyecto con ese nombre." };
    if (error) throw new Error("crear proyecto: " + error.message);
    return { creado: a.nombre };
  },
};

export const listarProyectos: Herramienta = {
  nombre: "listar_proyectos",
  descripcion: "Lista los proyectos del usuario con sus tareas pendientes.",
  nivel: "lectura",
  estado: "CONSULTANDO PROYECTOS",
  parametros: { type: "object", properties: { incluir_terminados: { type: "boolean" } } },
  async ejecutar(a, ctx) {
    const proyectos = (await proyectosDe(ctx.userId)).filter((p) => a.incluir_terminados || p.estado !== "terminado");
    const tareas = await tareasPendientes(ctx.userId);
    return {
      proyectos: proyectos.sort((x, y) => x.prioridad - y.prioridad).map((p) => ({
        nombre: p.nombre, alias: p.alias ?? [], cliente: p.cliente, prioridad: NOMBRE_PRIORIDAD[p.prioridad], estado: p.estado,
        tareas_pendientes: tareas.filter((t) => t.proyecto_id === p.id).length,
      })),
    };
  },
};

// =====================================================================
// RECORDATORIOS
// =====================================================================
interface Recordatorio { id: number; texto: string; cuando: string; estado: string; origen: string }

async function recordatoriosActivos(userId: string): Promise<Recordatorio[]> {
  const { data, error } = await admin().from("recordatorios").select("id, texto, cuando, estado, origen")
    .eq("user_id", userId).in("estado", ["pendiente", "avisado"]).order("cuando").limit(100);
  if (error) throw new Error("recordatorios: " + error.message);
  return (data ?? []) as Recordatorio[];
}

export const crearRecordatorio: Herramienta = {
  nombre: "crear_recordatorio",
  descripcion: "Programa un recordatorio. Si no se confirma, Jarvis insiste cada 5 minutos (por Telegram y en la app).",
  nivel: "escritura",
  estado: "PROGRAMANDO RECORDATORIO",
  parametros: {
    type: "object",
    properties: {
      texto: { type: "string", minLength: 2, maxLength: 300, description: "Qué hay que recordar." },
      cuando: { type: "string", minLength: 16, maxLength: 16, description: "Hora local AAAA-MM-DDTHH:MM." },
      insistir: { type: "boolean", description: "Insistir hasta que confirme (por defecto sí)." },
    },
    required: ["texto", "cuando"],
  },
  async ejecutar(a, ctx) {
    verificarTexto(a.texto as string);
    const cuando = localAUtc(a.cuando as string, ctx.ajustes.zona_horaria);
    if (cuando.getTime() < Date.now() - 60e3) return { error: "Esa hora ya pasó. Preguntá para cuándo." };
    const h = horarios(ctx);
    const primero = primerAviso(cuando, false, h);
    const { error } = await admin().from("recordatorios").insert({
      user_id: ctx.userId, texto: (a.texto as string).trim(), cuando: cuando.toISOString(), origen: "chat",
      insistir: a.insistir !== false, limite: limiteComun(primero).toISOString(), proximo_aviso: primero.toISOString(), canal: ctx.canal,
    });
    if (error) throw new Error("crear recordatorio: " + error.message);
    return {
      programado: true,
      cuando: describirCuando(cuando, h.zona),
      ...(primero.getTime() !== cuando.getTime() ? { nota: `Cae en su horario de no molestar: le aviso ${describirCuando(primero, h.zona)}.` } : {}),
      ...(ctx.ajustes.telegram_chat_id ? {} : { nota_telegram: "Telegram no está vinculado: solo podré avisarle con la app abierta. Se vincula en Ajustes." }),
    };
  },
};

export const listarRecordatorios: Herramienta = {
  nombre: "listar_recordatorios",
  descripcion: "Lista los recordatorios pendientes (incluye los avisos de reuniones).",
  nivel: "lectura",
  estado: "REVISANDO RECORDATORIOS",
  parametros: { type: "object", properties: {} },
  async ejecutar(_a, ctx) {
    const lista = await recordatoriosActivos(ctx.userId);
    return {
      recordatorios: lista.slice(0, 30).map((r) => ({
        texto: r.texto, cuando: describirCuando(new Date(r.cuando), ctx.ajustes.zona_horaria),
        ya_avisado: r.estado === "avisado", de_reunion: r.origen === "evento",
      })),
    };
  },
};

export const cancelarRecordatorio: Herramienta = {
  nombre: "cancelar_recordatorio",
  descripcion: "Prepara la cancelación de recordatorios. NO cancela: deja una tarjeta para confirmar.",
  nivel: "sensible",
  estado: "BUSCANDO RECORDATORIOS",
  parametros: {
    type: "object",
    properties: { recordatorio: { type: "string", minLength: 2, maxLength: 300 } },
    required: ["recordatorio"],
  },
  async proponer(a, ctx) {
    const elegidos = coincidencias(await recordatoriosActivos(ctx.userId), (r) => r.texto, a.recordatorio as string).slice(0, 5);
    if (!elegidos.length) return { nada: "No encontré recordatorios pendientes con esa descripción." };
    return {
      tipo: "cancelar_recordatorios",
      resumen: `Cancelar ${elegidos.length === 1 ? "1 recordatorio" : `${elegidos.length} recordatorios`}`,
      detalle: elegidos.map((r) => `${r.texto} (${describirCuando(new Date(r.cuando), ctx.ajustes.zona_horaria)})`),
      datos: { ids: elegidos.map((r) => r.id) },
    };
  },
};
