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

// =====================================================================
// Fase 1
// =====================================================================

/** Crea un elemento con clases y texto (siempre con textContent). */
export function el(etiqueta, clases = "", texto = "") {
  const e = document.createElement(etiqueta);
  if (clases) e.className = clases;
  if (texto) e.textContent = texto;
  return e;
}

/** Fecha corta y legible en es-AR. */
export function fechaCorta(iso) {
  try {
    return new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

/**
 * Tarjeta Confirmar / Cancelar para una acción sensible.
 * onResolver(confirmar:boolean) → Promise<string> con el texto del resultado.
 */
export function tarjetaConfirmacion(accion, onResolver) {
  const t = el("div", "mr-auto w-full max-w-[85%] bg-amber-950/40 border border-amber-500/60 rounded-xl px-3 py-3 text-sm space-y-2");
  t.dataset.accion = accion.id;
  t.append(el("p", "text-[11px] tracking-widest text-amber-300", "REQUIERE SU CONFIRMACIÓN"));
  t.append(el("p", "text-amber-100", accion.resumen));
  if (accion.detalle?.length) {
    const ul = el("ul", "list-disc pl-5 text-amber-100/80 text-xs space-y-1");
    for (const d of accion.detalle) ul.append(el("li", "", String(d)));
    t.append(ul);
  }
  const botones = el("div", "flex gap-2 pt-1");
  const si = el("button", "flex-1 bg-amber-500 text-slate-950 font-bold rounded py-2 disabled:opacity-50", "Confirmar");
  const no = el("button", "flex-1 border border-amber-700 text-amber-200 rounded py-2 disabled:opacity-50", "Cancelar");
  const estado = el("p", "text-xs text-amber-200/90 min-h-4");
  const resolver = async (confirmar) => {
    si.disabled = no.disabled = true;
    estado.textContent = confirmar ? "Ejecutando…" : "Cancelando…";
    try {
      estado.textContent = await onResolver(confirmar);
      botones.remove();
    } catch (e) {
      estado.textContent = "No se pudo: " + e.message;
      si.disabled = no.disabled = false;
    }
  };
  si.onclick = () => resolver(true);
  no.onclick = () => resolver(false);
  botones.append(si, no);
  t.append(botones, estado);
  $("msgs").appendChild(t);
  bajarChat();
  return t;
}
