// =====================================================================
// J.A.R.V.I.S. · Utilidades de interfaz
// Autor: Maldonado Jorge Matias
//
// Regla de seguridad: el texto del modelo o del usuario SIEMPRE se
// muestra con textContent, nunca con innerHTML.
// =====================================================================

export const $ = (id) => document.getElementById(id);

const CLASE_REACTOR = "reactor w-48 h-48 lg:w-64 lg:h-64 mt-6 shrink-0 ";

/** clase: "" | "escuchando" | "pensando" | "hablando" | "desconectado" */
export function setEstado(clase, texto) {
  $("reactor").className = CLASE_REACTOR + clase;
  $("estado").textContent = texto;
}

const ESTILOS = {
  user: "ml-auto max-w-[85%] bg-cyan-900/40 border border-cyan-800 rounded-xl rounded-br-none px-3 py-2 text-sm whitespace-pre-wrap break-words",
  jarvis: "mr-auto max-w-[85%] bg-slate-900/80 border border-cyan-500/40 rounded-xl rounded-bl-none px-3 py-2 text-sm text-cyan-200 whitespace-pre-wrap break-words",
  sistema: "mx-auto max-w-[90%] text-center text-xs text-amber-300/90 px-3 py-1",
};

/** Agrega un mensaje al chat y devuelve el elemento (para ir completándolo). */
export function agregarMsg(quien, texto) {
  const d = document.createElement("div");
  d.className = ESTILOS[quien] ?? ESTILOS.sistema;
  d.textContent = texto;
  $("msgs").appendChild(d);
  bajarChat();
  return d;
}

export function bajarChat() {
  const m = $("msgs");
  m.scrollTop = m.scrollHeight;
}

export function limpiarChat() {
  $("msgs").replaceChildren();
}

/** Muestra una sola de las vistas principales. */
export function mostrarVista(id) {
  for (const v of ["vistaCarga", "vistaLogin", "vistaApp"]) $(v).hidden = v !== id;
}

/** Muestra un solo paso del login. */
export function mostrarPasoLogin(id) {
  for (const p of ["formEmail", "formCodigo", "pasoMfaAlta", "formMfa"]) $(p).hidden = p !== id;
  const campo = $(id)?.querySelector("input");
  if (campo) setTimeout(() => campo.focus(), 50);
}

export function mensajeLogin(texto, error = false) {
  const p = $("loginMsg");
  p.textContent = texto;
  p.className = "min-h-5 mt-4 text-sm text-center " + (error ? "text-red-300" : "text-cyan-400");
}

export function abrirModal() { $("modal").hidden = false; }
export function cerrarModal() { $("modal").hidden = true; }

/** Llena el selector de voces sin usar innerHTML. */
export function llenarVoces(voces, elegida) {
  const sel = $("cfgVoz");
  sel.replaceChildren();
  if (!voces.length) {
    sel.append(new Option("Voz del sistema", ""));
    return;
  }
  for (const v of voces) {
    const o = new Option(`${v.name} (${v.lang})`, v.name);
    o.selected = v.name === elegida;
    sel.append(o);
  }
}

/** Saludo según la hora local. */
export function saludo() {
  const h = new Date().getHours();
  return h >= 5 && h < 13 ? "Buen día" : h >= 13 && h < 20 ? "Buenas tardes" : "Buenas noches";
}
