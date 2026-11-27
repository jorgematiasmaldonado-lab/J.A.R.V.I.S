// =====================================================================
// J.A.R.V.I.S. · Voz: hablar y escuchar
// Autor: Maldonado Jorge Matias
//
// Hablar: la respuesta llega de a pedazos; cada frase completa se
// encola en la síntesis del sistema, así Jarvis empieza a hablar antes
// de terminar de recibir.
//
// Escuchar: reconocimiento del navegador (es-AR). La transcripción la
// hace el navegador o el sistema; el audio nunca pasa por Jarvis.
// Manos libres: escucha continua esperando "Jarvis". En Chrome de
// Android el reconocimiento continuo se corta cada pocos segundos; se
// reinicia con espera creciente y se pausa con la pantalla oculta. La
// solución de fondo (Porcupine) llega con la app Android (Fase 4).
// =====================================================================

// ---------------- Preferencias de este dispositivo ----------------
const leer = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const escribir = (k, v) => { try { localStorage.setItem(k, v); } catch { /* modo privado */ } };

export const prefs = {
  voz: leer("jarvis_voz", ""),
  rate: parseFloat(leer("jarvis_rate", "0.95")),
  pitch: parseFloat(leer("jarvis_pitch", "0.85")),
  guardar() {
    escribir("jarvis_voz", this.voz);
    escribir("jarvis_rate", String(this.rate));
    escribir("jarvis_pitch", String(this.pitch));
  },
};

// Callbacks que conecta app.js
const cb = { onHablando: () => {}, onFinHablar: () => {}, onEscuchando: () => {}, onFinEscucha: () => {}, onInterino: () => {}, onOido: () => {}, onError: () => {} };
export function conectar(callbacks) { Object.assign(cb, callbacks); }

// =====================================================================
// HABLAR
// =====================================================================
const hayTTS = "speechSynthesis" in window;
let pendientes = 0;        // frases encoladas sin terminar
let bufferTexto = "";      // texto que todavía no forma una frase completa
let cerrada = true;        // ¿ya llegó toda la respuesta?
let resolverFin = null;
let generacion = 0;        // cambia en cada callar(): los eventos de frases canceladas se ignoran
export let hablando = false;

export function vocesEspanol() {
  if (!hayTTS) return [];
  return speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("es"));
}

function elegirVoz() {
  if (!hayTTS) return null;
  const voces = speechSynthesis.getVoices();
  return voces.find((v) => v.name === prefs.voz) ||
    voces.find((v) => v.lang === "es-AR") ||
    voces.find((v) => v.lang.toLowerCase().startsWith("es")) || null;
}

function limpiar(t) {
  return t.replace(/\[[A-Z]+_\d+\]/g, "esa persona").replace(/[*_#`>~|]/g, "").replace(/\s+/g, " ").trim();
}

function decir(frase) {
  const texto = limpiar(frase);
  if (!texto || !hayTTS) return;
  const u = new SpeechSynthesisUtterance(texto);
  const v = elegirVoz();
  if (v) { u.voice = v; u.lang = v.lang; } else u.lang = "es-AR";
  u.rate = prefs.rate;
  u.pitch = prefs.pitch;
  const gen = generacion;
  pendientes++;
  u.onstart = () => { if (gen === generacion && !hablando) { hablando = true; cb.onHablando(); } };
  u.onend = u.onerror = () => {
    if (gen !== generacion) return; // frase de una respuesta ya cancelada
    pendientes = Math.max(0, pendientes - 1);
    revisarFin();
  };
  speechSynthesis.speak(u);
}

function revisarFin() {
  if (cerrada && pendientes === 0) {
    const estaba = hablando;
    hablando = false;
    if (estaba) cb.onFinHablar();
    const r = resolverFin; resolverFin = null; r?.();
  }
}

/** Corta lo que se esté diciendo y prepara una respuesta nueva. */
export function empezarRespuesta() {
  callar();
  cerrada = false;
  bufferTexto = "";
}

/** Agrega texto recibido; dice cada frase apenas está completa. */
export function agregarTexto(delta) {
  bufferTexto += delta;
  // Frase completa: termina en . ! ? … : ; seguido de espacio (y tiene un largo razonable)
  let m;
  while ((m = bufferTexto.match(/^([\s\S]{12,}?[.!?…:;])(\s+)/))) {
    decir(m[1]);
    bufferTexto = bufferTexto.slice(m[0].length);
  }
}

/** Dice lo que falta y espera a que termine de hablar. */
export function terminarRespuesta() {
  if (bufferTexto.trim()) decir(bufferTexto);
  bufferTexto = "";
  cerrada = true;
  return new Promise((ok) => {
    resolverFin = ok;
    // Si la síntesis no arrancó (sin voces, bloqueada), no colgarse
    setTimeout(revisarFin, 0);
  });
}

/** Atajo para decir un texto completo. */
export function hablar(texto) {
  empezarRespuesta();
  agregarTexto(texto + " ");
  return terminarRespuesta();
}

export function callar() {
  generacion++;
  if (hayTTS) speechSynthesis.cancel();
  pendientes = 0;
  bufferTexto = "";
  cerrada = true;
  revisarFin();
}

// =====================================================================
// ESCUCHAR
// =====================================================================
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const hayReconocimiento = !!SR;

let rec = null;
export let manosLibres = false;
let esperandoOrden = false;
let inicioEscucha = 0;
let esperaReinicio = 300;
let bloqueado = () => false; // app.js indica cuándo no se debe escuchar (procesando)

export function alBloquear(fn) { bloqueado = fn; }
export function escuchandoAhora() { return !!rec; }

export function escuchar() {
  if (!SR) { cb.onError("sin_soporte"); return; }
  if (rec || hablando || bloqueado()) return;
  rec = new SR();
  rec.lang = "es-AR";
  rec.interimResults = true;
  rec.continuous = manosLibres;
  rec.maxAlternatives = 1;

  rec.onresult = (e) => {
    let interino = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) oido(r[0].transcript.trim());
      else interino += r[0].transcript;
    }
    cb.onInterino(interino);
  };
  rec.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      manosLibres = false;
      cb.onError("sin_permiso");
    } else if (e.error === "network") {
      cb.onError("red");
    }
  };
  rec.onend = () => {
    rec = null;
    cb.onInterino("");
    cb.onFinEscucha();
    if (manosLibres && !hablando && !bloqueado() && !document.hidden) {
      // Si se cortó enseguida (error o sin audio), esperar cada vez más (máx. 5 s)
      esperaReinicio = Date.now() - inicioEscucha < 1500 ? Math.min(esperaReinicio * 2, 5000) : 300;
      setTimeout(escuchar, esperaReinicio);
    }
  };
  try {
    rec.start();
    inicioEscucha = Date.now();
    cb.onEscuchando(manosLibres);
  } catch {
    rec = null;
  }
}

export function pararEscucha() {
  if (rec) { try { rec.abort(); } catch { /* ya estaba detenido */ } rec = null; }
}

export function activarManosLibres(activo) {
  manosLibres = activo;
  esperandoOrden = false;
  esperaReinicio = 300;
  pararEscucha();
  if (activo) escuchar();
}

// Con la pantalla oculta no se escucha (batería y privacidad); al volver, se retoma
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pararEscucha();
  else if (manosLibres) setTimeout(escuchar, 300);
});

/** Variantes con las que el reconocedor suele escribir "Jarvis". */
const PALABRA = /\b(jarvis|yarvis|llarvis|jarbis|jarvi|yarbis|charlie's|jervis)\b/i;

function oido(t) {
  if (!t) return;
  if (!manosLibres) { pararEscucha(); cb.onOido(t); return; }
  if (esperandoOrden) { esperandoOrden = false; pararEscucha(); cb.onOido(t); return; }
  const m = t.match(PALABRA);
  if (!m) return;
  const resto = t.slice(m.index + m[0].length).replace(/^[\s,.?¿!¡:]+/, "").trim();
  pararEscucha();
  if (resto.length > 3) cb.onOido(resto);
  else { esperandoOrden = true; cb.onOido(null); }
}
