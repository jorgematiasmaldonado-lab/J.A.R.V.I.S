// =====================================================================
// J.A.R.V.I.S. · Comunicación con el servidor
// Autor: Maldonado Jorge Matias
//
// - consultar(): habla con la Edge Function jarvis-chat (SSE).
// - El resto lee y escribe tablas propias; la RLS garantiza que solo
//   el dueño, con MFA, ve sus filas.
// =====================================================================

import { SUPABASE_CLAVE_PUBLICA, SUPABASE_URL } from "./config.js";
import { sb, usuarioId } from "./supa.js";

export class ErrorApi extends Error {
  constructor(mensaje, codigo, estado) {
    super(mensaje);
    this.codigo = codigo;
    this.estado = estado;
  }
}

const MENSAJES = {
  sin_sesion: "su sesión terminó; necesito que se identifique de nuevo",
  sesion_invalida: "su sesión venció; necesito que se identifique de nuevo",
  mfa_requerido: "falta la verificación en dos pasos",
  no_permitido: "este usuario no está autorizado",
  no_es_dueno: "falta registrar al dueño en la base de datos (paso 4 del README)",
  origen_no_permitido: "el servidor no reconoce esta dirección; revise ALLOWED_ORIGINS",
  limite: "recibí demasiadas consultas seguidas; deme un momento",
  peticion_invalida: "el mensaje no tiene un formato válido",
  mensaje_demasiado_grande: "el mensaje es demasiado largo",
  configuracion_incompleta: "falta configurar algo en el servidor (vea el README)",
  no_se_pudo: "no se pudo completar",
};

/**
 * Envía un mensaje y va entregando la respuesta.
 * @param {string} mensaje
 * @param {{ ubicacion?: {lat:number, lon:number}, onEstado?: (t:string)=>void, onTexto?: (t:string)=>void,
 *          onConfirmacion?: (accion: {id:string, resumen:string, detalle:string[], vence:string})=>void }} op
 * @returns {Promise<{ texto: string, aviso: string|null }>}
 */
export async function consultar(mensaje, op = {}) {
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ErrorApi(MENSAJES.sin_sesion, "sin_sesion", 401);

  let r;
  try {
    r = await fetch(`${SUPABASE_URL}/functions/v1/jarvis-chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
        "apikey": SUPABASE_CLAVE_PUBLICA,
      },
      body: JSON.stringify({ mensaje, canal: "web", ...(op.ubicacion ? { ubicacion: op.ubicacion } : {}) }),
    });
  } catch {
    throw new ErrorApi("no logro comunicarme con el servidor; revise la conexión", "red", 0);
  }

  if (!r.ok) {
    let j = {};
    try { j = await r.json(); } catch { /* sin cuerpo */ }
    throw new ErrorApi(MENSAJES[j.error] ?? j.mensaje ?? `error ${r.status} del servidor`, j.error ?? "http", r.status);
  }

  // Lectura de Server-Sent Events: bloques separados por una línea en blanco
  const lector = r.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let final = null;
  while (true) {
    const { value, done } = await lector.read();
    if (done) break;
    buffer += value.replace(/\r\n/g, "\n");
    let corte;
    while ((corte = buffer.indexOf("\n\n")) >= 0) {
      const bloque = buffer.slice(0, corte);
      buffer = buffer.slice(corte + 2);
      let evento = "message", datos = "";
      for (const linea of bloque.split("\n")) {
        if (linea.startsWith("event:")) evento = linea.slice(6).trim();
        else if (linea.startsWith("data:")) datos += linea.slice(5).trim();
      }
      let d = {};
      try { d = JSON.parse(datos || "{}"); } catch { continue; }
      if (evento === "texto") op.onTexto?.(d.t ?? "");
      else if (evento === "estado") op.onEstado?.(d.texto ?? "");
      else if (evento === "confirmacion") op.onConfirmacion?.(d);
      else if (evento === "fin") final = { texto: d.texto ?? "", aviso: d.aviso ?? null };
      else if (evento === "error") throw new ErrorApi(d.mensaje ?? "tuve un inconveniente", "servidor", 200);
    }
  }
  if (!final) throw new ErrorApi("la respuesta se cortó a mitad de camino", "cortada", 200);
  return final;
}

/** Últimos mensajes guardados (para mostrar la charla al abrir). */
export async function cargarHistorial(cantidad = 30) {
  const { data, error } = await sb.from("mensajes").select("rol, contenido").order("id", { ascending: false }).limit(cantidad);
  if (error) throw new ErrorApi("no pude cargar la conversación", "db", 0);
  return (data ?? []).reverse();
}

export async function borrarHistorial() {
  const uid = await usuarioId();
  const { error } = await sb.from("mensajes").delete().eq("user_id", uid);
  if (error) throw new ErrorApi("no pude borrar la conversación", "db", 0);
}

const COLUMNAS_AJUSTES =
  "nombre_trato, ciudad_base, resumen_activo, resumen_hora, no_molestar_desde, no_molestar_hasta, avisar_eventos, google_conectado, telegram_chat_id";

export async function leerAjustes() {
  const { data, error } = await sb.from("ajustes").select(COLUMNAS_AJUSTES).maybeSingle();
  if (error) throw new ErrorApi("no pude leer los ajustes", "db", 0);
  return data ?? {
    nombre_trato: "señor", ciudad_base: null, resumen_activo: true, resumen_hora: "07:30:00",
    no_molestar_desde: "23:00:00", no_molestar_hasta: "07:00:00", avisar_eventos: true, google_conectado: false, telegram_chat_id: null,
  };
}

/** Guarda solo columnas que la app puede escribir (el servidor protege el resto). */
export async function guardarAjustes({ ciudadCambio, ...campos }) {
  const uid = await usuarioId();
  const permitidos = ["nombre_trato", "ciudad_base", "resumen_activo", "resumen_hora", "no_molestar_desde", "no_molestar_hasta", "avisar_eventos"];
  const fila = { user_id: uid, actualizado: new Date().toISOString() };
  for (const k of permitidos) if (k in campos) fila[k] = campos[k];
  if ("ciudad_base" in fila) fila.ciudad_base = fila.ciudad_base || null;
  // Si cambió la ciudad, se borran las coordenadas para que el servidor la vuelva a buscar
  if (ciudadCambio) Object.assign(fila, { ciudad_lat: null, ciudad_lon: null });
  // Primero se actualiza; si todavía no hay fila, se crea. (No se usa "upsert" porque
  // reescribiría user_id, y la base solo permite cambiar estas columnas puntuales.)
  const { user_id, ...cambios } = fila;
  const { data, error } = await sb.from("ajustes").update(cambios).eq("user_id", user_id).select("user_id");
  if (error) throw new ErrorApi("no pude guardar los ajustes", "db", 0);
  if (!data?.length) {
    const { error: e2 } = await sb.from("ajustes").insert(fila);
    if (e2) throw new ErrorApi("no pude guardar los ajustes", "db", 0);
  }
}

// =====================================================================
// Fase 1 · Memoria, perfil, nombres protegidos, actividad y confirmaciones
// =====================================================================

/** Llama a una Edge Function propia con la sesión actual. */
async function llamarFuncion(nombre, cuerpo) {
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ErrorApi(MENSAJES.sin_sesion, "sin_sesion", 401);
  let r;
  try {
    r = await fetch(`${SUPABASE_URL}/functions/v1/${nombre}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}`, "apikey": SUPABASE_CLAVE_PUBLICA },
      body: JSON.stringify(cuerpo),
    });
  } catch {
    throw new ErrorApi("no logro comunicarme con el servidor; revise la conexión", "red", 0);
  }
  let j = {};
  try { j = await r.json(); } catch { /* sin cuerpo */ }
  if (!r.ok) throw new ErrorApi(j.mensaje ?? MENSAJES[j.error] ?? `error ${r.status} del servidor`, j.error ?? "http", r.status);
  return j;
}

const llamarAcciones = (cuerpo) => llamarFuncion("jarvis-acciones", cuerpo);

export const crearMemoria = (texto, categoria) => llamarAcciones({ accion: "memoria_crear", texto, categoria });
export const editarMemoria = (id, texto, categoria) => llamarAcciones({ accion: "memoria_editar", id, texto, categoria });
export const guardarPerfil = (texto) => llamarAcciones({ accion: "perfil_guardar", texto });
export const resolverAccion = (id, confirmar) => llamarAcciones({ accion: confirmar ? "confirmar" : "cancelar", id });

function errorDb(error, que) {
  if (error) throw new ErrorApi(`no pude ${que}`, "db", 0);
}

export async function listarMemorias() {
  const { data, error } = await sb.from("memorias")
    .select("id, texto, categoria, fuente, creado, actualizado").order("creado", { ascending: false }).limit(500);
  errorDb(error, "leer los recuerdos");
  return data ?? [];
}

export async function borrarMemoria(id) {
  const { error } = await sb.from("memorias").delete().eq("id", id);
  errorDb(error, "borrar el recuerdo");
}

export async function leerPerfil() {
  const { data, error } = await sb.from("perfil").select("texto").maybeSingle();
  errorDb(error, "leer el perfil");
  return data?.texto ?? "";
}

export async function listarSeudonimos() {
  const { data, error } = await sb.from("seudonimos").select("id, tipo, valor, alias").order("valor");
  errorDb(error, "leer los nombres protegidos");
  return data ?? [];
}

export async function agregarSeudonimo({ tipo, valor, alias }) {
  const uid = await usuarioId();
  const { error } = await sb.from("seudonimos").insert({ user_id: uid, tipo, valor, alias });
  if (error?.code === "23505") throw new ErrorApi("ese nombre ya está protegido", "duplicado", 0);
  errorDb(error, "guardar el nombre");
}

export async function borrarSeudonimo(id) {
  const { error } = await sb.from("seudonimos").delete().eq("id", id);
  errorDb(error, "borrar el nombre");
}

export async function listarActividad(cantidad = 60) {
  const { data, error } = await sb.from("actividad")
    .select("id, tipo, herramienta, ok, canal, creado, parametros, resultado").order("id", { ascending: false }).limit(cantidad);
  errorDb(error, "leer la actividad");
  return data ?? [];
}

export async function accionesPendientes() {
  const { data, error } = await sb.from("acciones_pendientes")
    .select("id, tipo, resumen, detalle, vence").eq("estado", "pendiente").gt("vence", new Date().toISOString())
    .order("creado", { ascending: true });
  errorDb(error, "leer las acciones pendientes");
  return data ?? [];
}

// =====================================================================
// Fase 2 · Hoy, tareas, recordatorios, agenda y conexiones
// =====================================================================

export async function ultimoResumen() {
  const { data, error } = await sb.from("resumenes").select("fecha, texto").order("fecha", { ascending: false }).limit(1).maybeSingle();
  errorDb(error, "leer el resumen");
  return data;
}
export const resumenAhora = () => llamarAcciones({ accion: "resumen_ahora" });
export const agendaHoy = () => llamarAcciones({ accion: "agenda_hoy" });
export const crearTarea = (titulo, vence, prioridad) =>
  llamarAcciones({ accion: "tarea_crear", titulo, ...(vence ? { vence } : {}), ...(prioridad ? { prioridad } : {}) });

export async function tareasPendientes() {
  const { data, error } = await sb.from("tareas").select("id, titulo, vence, prioridad, proyecto_id")
    .eq("estado", "pendiente").order("vence", { ascending: true, nullsFirst: false }).order("prioridad").limit(100);
  errorDb(error, "leer las tareas");
  return data ?? [];
}

export async function completarTarea(id) {
  const ahora = new Date().toISOString();
  const { error } = await sb.from("tareas").update({ estado: "hecha", completada: ahora, actualizado: ahora }).eq("id", id);
  errorDb(error, "completar la tarea");
}

export async function borrarTarea(id) {
  const { error } = await sb.from("tareas").delete().eq("id", id);
  errorDb(error, "borrar la tarea");
}

export async function proximosRecordatorios() {
  const desde = new Date(Date.now() - 12 * 3600e3).toISOString();
  const { data, error } = await sb.from("recordatorios").select("id, texto, cuando, estado, origen")
    .in("estado", ["pendiente", "avisado"]).gte("cuando", desde).order("cuando").limit(50);
  errorDb(error, "leer los recordatorios");
  return data ?? [];
}

/** Recordatorios ya avisados que esperan "Entendido" (para el aviso dentro de la app). */
export async function avisosSinConfirmar() {
  const desde = new Date(Date.now() - 12 * 3600e3).toISOString();
  const { data, error } = await sb.from("recordatorios").select("id, texto, cuando")
    .eq("estado", "avisado").gte("cuando", desde).order("cuando").limit(10);
  errorDb(error, "leer los avisos");
  return data ?? [];
}

export async function confirmarRecordatorio(id) {
  const { error } = await sb.from("recordatorios").update({ estado: "confirmado", confirmado: new Date().toISOString() }).eq("id", id);
  errorDb(error, "confirmar el recordatorio");
}

export async function cancelarRecordatorio(id) {
  const { error } = await sb.from("recordatorios").update({ estado: "cancelado" }).eq("id", id);
  errorDb(error, "cancelar el recordatorio");
}

export const conexiones = () => llamarAcciones({ accion: "conexiones" });
export const telegramCodigo = () => llamarAcciones({ accion: "telegram_codigo" });
export const telegramDesvincular = () => llamarAcciones({ accion: "telegram_desvincular" });
export const googleIniciar = () => llamarFuncion("jarvis-google", { accion: "iniciar" });
export const googleDesconectar = () => llamarFuncion("jarvis-google", { accion: "desconectar" });
