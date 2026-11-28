// =====================================================================
// J.A.R.V.I.S. · Pantalla Hoy, conexiones (Google / Telegram) y avisos en la app
// Autor: Maldonado Jorge Matias
//
// Todo el texto se muestra con textContent. Completar, borrar tareas y
// confirmar/cancelar recordatorios va directo a la base (la RLS y los
// permisos por columna solo permiten esos cambios); crear tareas y
// conectar servicios pasa por las Edge Functions.
// =====================================================================

import * as api from "./api.js";
import { $, el } from "./ui.js";

const PRIORIDAD = { 1: "alta", 2: "normal", 3: "baja" };
const BOTON = "border border-cyan-800 rounded px-2 py-1 text-xs text-cyan-300 disabled:opacity-50 shrink-0";
const BOTON_ROJO = "border border-red-900 rounded px-2 py-1 text-xs text-red-300 disabled:opacity-50 shrink-0";

function aviso(id, texto, error = false) {
  const p = $(id);
  p.textContent = texto;
  p.className = "text-xs min-h-4 " + (error ? "text-red-300" : "text-cyan-500");
}

function fechaHora(iso) {
  const d = new Date(iso), hoy = new Date();
  const manana = new Date(hoy.getTime() + 86400e3);
  const hora = d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === hoy.toDateString()) return `hoy ${hora}`;
  if (d.toDateString() === manana.toDateString()) return `mañana ${hora}`;
  return d.toLocaleString("es-AR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function hoyIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

let hablarCb = () => {};
/** app.js le pasa la función para hablar (la voz vive en app.js / voz.js). */
export function conectarVoz(fn) { hablarCb = fn; }

// =====================================================================
// PANTALLA HOY
// =====================================================================
export async function cargarHoy() {
  await Promise.all([cargarResumen(), cargarAgenda(), cargarTareas(), cargarRecordatorios()]);
}

async function cargarResumen() {
  try {
    const r = await api.ultimoResumen();
    $("resumenTexto").textContent = r?.texto ?? "Todavía no hay resumen. Se genera solo cada mañana, o tóquelo en «Generar ahora».";
    $("resumenFecha").textContent = r ? (r.fecha === hoyIso() ? "De hoy" : `Del ${r.fecha.split("-").reverse().join("/")}`) : "";
  } catch (e) { $("resumenTexto").textContent = e.message; }
}

$("btnResumenAhora").onclick = async () => {
  const b = $("btnResumenAhora");
  b.disabled = true;
  $("resumenFecha").textContent = "Preparando el resumen…";
  try {
    const r = await api.resumenAhora();
    $("resumenTexto").textContent = r.texto;
    $("resumenFecha").textContent = "De hoy (también se envió por Telegram, si está vinculado)";
  } catch (e) { $("resumenFecha").textContent = "No se pudo: " + e.message; }
  finally { b.disabled = false; }
};
$("btnResumenEscuchar").onclick = () => { const t = $("resumenTexto").textContent.trim(); if (t) hablarCb(t); };

async function cargarAgenda() {
  const lista = $("agendaLista");
  lista.replaceChildren(el("p", "text-xs text-cyan-600", "Consultando el calendario…"));
  try {
    const r = await api.agendaHoy();
    lista.replaceChildren();
    if (!r.conectado) {
      lista.append(el("p", "text-xs text-cyan-700", "Google Calendar no está conectado. Se conecta en Ajustes → Conexiones."));
      return;
    }
    if (!r.eventos.length) { lista.append(el("p", "text-xs text-cyan-700", "Sin eventos hoy ni mañana.")); return; }
    for (const e of r.eventos) {
      const fila = el("div", "flex items-baseline gap-3 bg-slate-900/80 border border-cyan-900 rounded-lg px-3 py-2");
      fila.append(el("span", "text-xs text-cyan-400 shrink-0 w-24", `${e.dia} ${e.hora ?? "todo el día"}`));
      const info = el("div", "min-w-0");
      info.append(el("p", "text-sm text-cyan-100 break-words", e.titulo));
      if (e.lugar) info.append(el("p", "text-[11px] text-cyan-600 break-words", e.lugar));
      fila.append(info);
      lista.append(fila);
    }
  } catch (e) {
    lista.replaceChildren(el("p", "text-xs text-red-300", e.message));
  }
}

async function cargarTareas() {
  const lista = $("tareasLista");
  try {
    const tareas = await api.tareasPendientes();
    $("tareasCuenta").textContent = tareas.length ? `(${tareas.length})` : "";
    lista.replaceChildren();
    if (!tareas.length) { lista.append(el("p", "text-xs text-cyan-700", "Sin tareas pendientes.")); return; }
    const hoy = hoyIso();
    for (const t of tareas) {
      const fila = el("div", "flex items-center gap-2 bg-slate-900/80 border border-cyan-900 rounded-lg px-3 py-2");
      const hecha = el("input", "accent-cyan-400 shrink-0");
      hecha.type = "checkbox";
      hecha.setAttribute("aria-label", "Marcar como hecha");
      const info = el("div", "min-w-0 flex-1");
      info.append(el("p", "text-sm text-cyan-100 break-words", t.titulo));
      const meta = [];
      if (t.vence) meta.push((t.vence < hoy ? "VENCIDA · " : "") + "vence " + t.vence.split("-").reverse().join("/"));
      if (t.prioridad !== 2) meta.push("prioridad " + PRIORIDAD[t.prioridad]);
      if (meta.length) info.append(el("p", "text-[11px] " + (t.vence && t.vence < hoy ? "text-amber-300" : "text-cyan-600"), meta.join(" · ")));
      const borrar = el("button", BOTON_ROJO, "Borrar");
      hecha.onchange = async () => {
        hecha.disabled = true;
        try { await api.completarTarea(t.id); fila.remove(); cargarTareas(); } catch (e) { alert(e.message); hecha.checked = false; hecha.disabled = false; }
      };
      borrar.onclick = async () => {
        if (!confirm(`¿Borrar la tarea "${t.titulo}"?`)) return;
        borrar.disabled = true;
        try { await api.borrarTarea(t.id); cargarTareas(); } catch (e) { alert(e.message); borrar.disabled = false; }
      };
      fila.append(hecha, info, borrar);
      lista.append(fila);
    }
  } catch (e) {
    lista.replaceChildren(el("p", "text-xs text-red-300", e.message));
  }
}

$("formTarea").onsubmit = async (e) => {
  e.preventDefault();
  const titulo = $("tareaTitulo").value.trim();
  if (titulo.length < 2) return;
  const b = e.target.querySelector("button");
  b.disabled = true;
  try {
    await api.crearTarea(titulo, $("tareaVence").value || null, Number($("tareaPrioridad").value));
    $("tareaTitulo").value = ""; $("tareaVence").value = ""; $("tareaPrioridad").value = "2";
    aviso("tareaMsg", "Tarea anotada.");
    cargarTareas();
  } catch (err) { aviso("tareaMsg", err.message, true); }
  finally { b.disabled = false; }
};

async function cargarRecordatorios() {
  const lista = $("recLista");
  try {
    const recs = await api.proximosRecordatorios();
    lista.replaceChildren();
    if (!recs.length) { lista.append(el("p", "text-xs text-cyan-700", "Sin recordatorios próximos.")); return; }
    for (const r of recs) {
      const fila = el("div", "flex items-center gap-2 bg-slate-900/80 border border-cyan-900 rounded-lg px-3 py-2");
      const info = el("div", "min-w-0 flex-1");
      info.append(el("p", "text-sm text-cyan-100 break-words", r.texto));
      info.append(el("p", "text-[11px] text-cyan-600",
        `${fechaHora(r.cuando)}${r.estado === "avisado" ? " · avisado, sin confirmar" : ""}${r.origen === "evento" ? " · reunión" : ""}`));
      const cancelar = el("button", BOTON_ROJO, "Cancelar");
      cancelar.onclick = async () => {
        if (!confirm("¿Cancelar este recordatorio?")) return;
        cancelar.disabled = true;
        try { await api.cancelarRecordatorio(r.id); cargarRecordatorios(); } catch (e) { alert(e.message); cancelar.disabled = false; }
      };
      fila.append(info, cancelar);
      lista.append(fila);
    }
  } catch (e) {
    lista.replaceChildren(el("p", "text-xs text-red-300", e.message));
  }
}

// =====================================================================
// CONEXIONES (en Ajustes)
// =====================================================================
let estadoConexiones = null;

export async function cargarConexiones() {
  $("telegramVinculo").hidden = true;
  $("conexMsg").textContent = "";
  try {
    estadoConexiones = await api.conexiones();
    const c = estadoConexiones;
    $("conexGoogleEstado").textContent = c.google ? "Conectado: Jarvis puede ver y crear eventos." :
      c.google_configurado ? "No conectado." : "Falta configurar Google en el servidor (README, Fase 2).";
    $("btnGoogle").textContent = c.google ? "Desconectar" : "Conectar";
    $("btnGoogle").disabled = !c.google && !c.google_configurado;
    $("conexTelegramEstado").textContent = c.telegram ? "Vinculado: recibe avisos y puede hablar con Jarvis." :
      c.telegram_configurado ? "No vinculado." : "Falta configurar el bot en el servidor (README, Fase 2).";
    $("btnTelegram").textContent = c.telegram ? "Desvincular" : "Vincular";
    $("btnTelegram").disabled = !c.telegram && !c.telegram_configurado;
  } catch (e) {
    $("conexGoogleEstado").textContent = $("conexTelegramEstado").textContent = "No se pudo consultar.";
    $("conexMsg").textContent = e.message;
  }
}

$("btnGoogle").onclick = async () => {
  const b = $("btnGoogle");
  b.disabled = true;
  try {
    if (estadoConexiones?.google) {
      if (!confirm("¿Desconectar Google Calendar? Jarvis deja de ver su agenda y se cancelan los avisos de reuniones pendientes.")) return;
      await api.googleDesconectar();
      await cargarConexiones();
    } else {
      const { url } = await api.googleIniciar();
      // Solo se navega a la página oficial de Google
      if (!url.startsWith("https://accounts.google.com/")) throw new Error("dirección de Google inesperada");
      location.assign(url);
    }
  } catch (e) { $("conexMsg").textContent = e.message; }
  finally { b.disabled = false; }
};

$("btnTelegram").onclick = async () => {
  const b = $("btnTelegram");
  b.disabled = true;
  try {
    if (estadoConexiones?.telegram) {
      if (!confirm("¿Desvincular Telegram? Dejará de recibir avisos por ahí.")) return;
      await api.telegramDesvincular();
      await cargarConexiones();
    } else {
      const r = await api.telegramCodigo();
      if (!/^https:\/\/t\.me\/[A-Za-z0-9_]+\?start=[A-Za-z0-9_-]+$/.test(r.enlace)) throw new Error("enlace inesperado");
      $("telegramEnlace").href = r.enlace;
      $("telegramEnlace").textContent = r.enlace;
      $("telegramVinculo").hidden = false;
    }
  } catch (e) { $("conexMsg").textContent = e.message; }
  finally { b.disabled = false; }
};

/** Después de volver de Google: devuelve un mensaje para mostrar (o null) y limpia la URL. */
export function retornoDeGoogle() {
  const p = new URLSearchParams(location.search);
  const g = p.get("google");
  if (!g) return null;
  history.replaceState(null, "", location.pathname);
  return {
    ok: "Google Calendar conectado. A partir de ahora veo su agenda y le aviso las reuniones.",
    cancelado: "Conexión con Google cancelada. No se guardó ningún permiso.",
    error: "No pude conectar Google Calendar. Revise la configuración (README, Fase 2) e intente de nuevo.",
  }[g] ?? null;
}

// =====================================================================
// AVISOS DENTRO DE LA APP (complementan a Telegram)
// =====================================================================
const yaAnunciados = new Set();

export async function revisarAvisos() {
  let avisos = [];
  try { avisos = await api.avisosSinConfirmar(); } catch { return; }
  const cont = $("avisosApp");
  cont.replaceChildren();
  for (const a of avisos) {
    const caja = el("div", "max-w-xl mx-auto flex items-center gap-2 bg-amber-950/60 border border-amber-500/70 rounded-lg px-3 py-2");
    caja.append(el("span", "shrink-0", "⏰"));
    caja.append(el("p", "text-sm text-amber-100 flex-1 min-w-0 break-words", a.texto));
    const ok = el("button", "bg-amber-500 text-slate-950 font-bold rounded px-3 py-1 text-xs shrink-0 disabled:opacity-50", "Entendido");
    ok.onclick = async () => {
      ok.disabled = true;
      try { await api.confirmarRecordatorio(a.id); caja.remove(); } catch (e) { alert(e.message); ok.disabled = false; }
    };
    caja.append(ok);
    cont.append(caja);
    if (!yaAnunciados.has(a.id)) { yaAnunciados.add(a.id); hablarCb(`Recordatorio: ${a.texto}`); }
  }
}
