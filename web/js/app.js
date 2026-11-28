// =====================================================================
// J.A.R.V.I.S. · Aplicación principal (orquesta interfaz, voz y servidor)
// Autor: Maldonado Jorge Matias
// =====================================================================

import { CONFIGURADO, VERSION } from "./config.js";
import { sb } from "./supa.js";
import * as auth from "./auth.js";
import * as api from "./api.js";
import * as voz from "./voz.js";
import { cargarActividad, cargarMemoria } from "./paneles.js";
import {
  $, abrirModal, agregarMsg, bajarChat, cerrarModal, limpiarChat, llenarVoces, mensajeLogin, mostrarPasoLogin,
  mostrarVista, saludo, setEstado, tarjetaConfirmacion,
} from "./ui.js";

// ---------------------------------------------------------------------
// Anti-clickjacking: GitHub Pages no permite enviar el encabezado
// frame-ancestors, así que si alguien mete la app en un iframe, no se
// muestra nada.
// ---------------------------------------------------------------------
if (window.top !== window.self) {
  document.body.replaceChildren();
  throw new Error("J.A.R.V.I.S. no puede abrirse dentro de otra página.");
}

// ---------------------------------------------------------------------
// Limpieza de la versión anterior: la clave de Gemini y el historial
// en texto plano NO deben quedar en el teléfono.
// ---------------------------------------------------------------------
for (const k of ["jarvis_key", "jarvis_historial", "jarvis_ubic", "jarvis_modelo", "jarvis_nombre"]) {
  try { localStorage.removeItem(k); } catch { /* modo privado */ }
}

// ---------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------
let ocupado = false;
let ajustes = { nombre_trato: "señor", ciudad_base: null };
let ubicacion = null; // { lat, lon } redondeada a ~1 km
const usarUbicacion = {
  get() { try { return localStorage.getItem("jarvis_usar_ubicacion") !== "no"; } catch { return true; } },
  set(v) { try { localStorage.setItem("jarvis_usar_ubicacion", v ? "si" : "no"); } catch { /* */ } },
};

const ESTADO_REPOSO = () => (voz.manosLibres ? 'ESPERANDO "JARVIS"' : "EN LÍNEA");

// =====================================================================
// INICIO
// =====================================================================
async function iniciar() {
  $("version").textContent = VERSION.startsWith("__") ? "desarrollo" : VERSION;
  if (!CONFIGURADO) {
    mostrarVista("vistaLogin");
    mostrarPasoLogin("");
    mensajeLogin("Falta configurar la conexión con Supabase (README, paso 6).", true);
    return;
  }
  await enrutar();
}

/** Decide qué pantalla mostrar según el estado de la sesión. */
async function enrutar() {
  const estado = await auth.estadoSesion();
  if (estado === "lista") return entrarApp();
  mostrarVista("vistaLogin");
  mensajeLogin("");
  if (estado === "sin_sesion") mostrarPasoLogin("formEmail");
  else if (estado === "mfa_verificar") mostrarPasoLogin("formMfa");
  else if (estado === "mfa_alta") await prepararAltaMfa();
}

// =====================================================================
// LOGIN
// =====================================================================
let emailIngresado = "";
let factorAlta = null;

$("formEmail").onsubmit = async (e) => {
  e.preventDefault();
  emailIngresado = $("loginEmail").value.trim().toLowerCase();
  if (!emailIngresado) return;
  bloquearForm(e.target, true);
  try {
    await auth.enviarCodigo(emailIngresado);
    mostrarPasoLogin("formCodigo");
    mensajeLogin("Si el email está autorizado, le llegó un código. Revise también el spam.");
  } catch (err) {
    mensajeLogin(err.message, true);
  } finally { bloquearForm(e.target, false); }
};

$("formCodigo").onsubmit = async (e) => {
  e.preventDefault();
  bloquearForm(e.target, true);
  try {
    await auth.verificarCodigo(emailIngresado, $("loginCodigo").value.trim());
    $("loginCodigo").value = "";
    await enrutar();
  } catch (err) {
    mensajeLogin(err.message, true);
  } finally { bloquearForm(e.target, false); }
};

$("btnOtroEmail").onclick = () => { mostrarPasoLogin("formEmail"); mensajeLogin(""); };

async function prepararAltaMfa() {
  mostrarPasoLogin("pasoMfaAlta");
  mensajeLogin("Configurando la verificación en dos pasos…");
  try {
    factorAlta = await auth.iniciarAltaMfa();
    $("mfaQr").src = factorAlta.qr;
    $("mfaSecreto").textContent = factorAlta.secreto;
    mensajeLogin("");
  } catch (err) {
    mensajeLogin(err.message, true);
  }
}

$("formMfaAlta").onsubmit = async (e) => {
  e.preventDefault();
  if (!factorAlta) return;
  bloquearForm(e.target, true);
  try {
    await auth.confirmarAltaMfa(factorAlta.factorId, $("mfaAltaCodigo").value.trim());
    factorAlta = null;
    $("mfaQr").removeAttribute("src");
    $("mfaSecreto").textContent = "";
    await enrutar();
  } catch (err) {
    mensajeLogin(err.message, true);
  } finally { bloquearForm(e.target, false); }
};

$("formMfa").onsubmit = async (e) => {
  e.preventDefault();
  bloquearForm(e.target, true);
  try {
    await auth.verificarMfa($("mfaCodigo").value.trim());
    $("mfaCodigo").value = "";
    await enrutar();
  } catch (err) {
    mensajeLogin(err.message, true);
  } finally { bloquearForm(e.target, false); }
};

$("btnSalirLogin").onclick = async () => { await auth.cerrarSesion(false); await enrutar(); };

function bloquearForm(form, si) {
  for (const el of form.querySelectorAll("button, input")) el.disabled = si;
}

// =====================================================================
// APP
// =====================================================================
async function entrarApp() {
  mostrarVista("vistaApp");
  setEstado("", "EN LÍNEA");
  limpiarChat();
  try { ajustes = await api.leerAjustes(); } catch { /* se usan los valores por defecto */ }
  try {
    const historial = await api.cargarHistorial(30);
    for (const m of historial) agregarMsg(m.rol === "user" ? "user" : "jarvis", m.contenido);
  } catch (err) {
    agregarMsg("sistema", "No pude cargar la conversación anterior: " + err.message);
  }
  agregarMsg("jarvis", `${saludo()}, ${ajustes.nombre_trato}. Toque el reactor y hábleme.`);
  mostrarPanel("panelChat");
  // Acciones sensibles que quedaron esperando confirmación (p. ej. desde otro dispositivo)
  try {
    for (const a of await api.accionesPendientes()) mostrarTarjeta(a);
  } catch { /* no es grave: se pueden volver a pedir */ }
  actualizarUbicacion();
}

// ---------------- Pestañas ----------------
function mostrarPanel(id) {
  for (const b of document.querySelectorAll(".pestana")) {
    const activa = b.dataset.panel === id;
    b.classList.toggle("activa", activa);
    b.setAttribute("aria-selected", String(activa));
  }
  for (const p of ["panelChat", "panelMemoria", "panelActividad"]) $(p).hidden = p !== id;
  if (id === "panelMemoria") cargarMemoria();
  if (id === "panelActividad") cargarActividad();
}
for (const b of document.querySelectorAll(".pestana")) b.onclick = () => mostrarPanel(b.dataset.panel);

// ---------------- Confirmaciones ----------------
function mostrarTarjeta(accion) {
  tarjetaConfirmacion(accion, async (confirmar) => {
    const r = await api.resolverAccion(accion.id, confirmar);
    if (r.estado === "cancelada") return "Cancelado. No se hizo nada.";
    if (r.resultado?.borrados != null) {
      const n = r.resultado.borrados;
      voz.hablar(n ? `Listo, ${ajustes.nombre_trato}. Ya lo olvidé.` : "No quedaba nada para borrar.");
      return n ? `Hecho: ${n} ${n === 1 ? "recuerdo olvidado" : "recuerdos olvidados"}.` : "No quedaba nada para borrar.";
    }
    return "Hecho.";
  });
}

// ---------------- Ubicación del dispositivo (opcional) ----------------
function actualizarUbicacion() {
  if (!usarUbicacion.get() || !navigator.geolocation) { ubicacion = null; return; }
  navigator.geolocation.getCurrentPosition(
    (p) => {
      // Redondeo a 2 decimales (~1 km): no hace falta más precisión para el clima
      ubicacion = { lat: Math.round(p.coords.latitude * 100) / 100, lon: Math.round(p.coords.longitude * 100) / 100 };
    },
    () => { ubicacion = null; },
    { timeout: 10000, maximumAge: 10 * 60 * 1000, enableHighAccuracy: false },
  );
}
setInterval(() => { if (!document.hidden && sb) actualizarUbicacion(); }, 30 * 60 * 1000);

// ---------------- Flujo principal ----------------
async function procesar(texto) {
  texto = (texto ?? "").trim();
  if (!texto || ocupado) return;
  ocupado = true;
  voz.pararEscucha();
  voz.empezarRespuesta();
  agregarMsg("user", texto);
  setEstado("pensando", "PROCESANDO");

  const burbuja = agregarMsg("jarvis", "");
  burbuja.classList.add("escribiendo");
  let recibido = "";
  let codigoError = null;
  const tarjetas = [];

  try {
    const res = await api.consultar(texto, {
      ubicacion: ubicacion ?? undefined,
      onEstado: (t) => { if (!voz.hablando) setEstado("pensando", t); },
      onConfirmacion: (a) => tarjetas.push(a),
      onTexto: (d) => {
        recibido += d;
        burbuja.textContent = recibido;
        bajarChat();
        voz.agregarTexto(d);
      },
    });
    if (!recibido.trim()) voz.agregarTexto(res.texto + " ");
    burbuja.textContent = res.texto;
    if (res.aviso) agregarMsg("sistema", res.aviso);
  } catch (err) {
    codigoError = err.codigo;
    const msg = `Disculpe, ${ajustes.nombre_trato}, ${err.message}.`;
    voz.empezarRespuesta();
    voz.agregarTexto(msg + " ");
    burbuja.textContent = msg;
  } finally {
    burbuja.classList.remove("escribiendo");
    // Las tarjetas van debajo de la respuesta que las explica
    for (const a of tarjetas) mostrarTarjeta(a);
    bajarChat();
    ocupado = false;
  }

  await voz.terminarRespuesta();
  if (!voz.hablando) setEstado("", ESTADO_REPOSO());
  if (["sin_sesion", "sesion_invalida", "mfa_requerido"].includes(codigoError)) await enrutar();
}

// ---------------- Conexión con la voz ----------------
voz.alBloquear(() => ocupado);
voz.conectar({
  onHablando: () => setEstado("hablando", "RESPONDIENDO"),
  onFinHablar: () => {
    if (!ocupado) setEstado("", ESTADO_REPOSO());
    if (voz.manosLibres && !ocupado) setTimeout(voz.escuchar, 400);
  },
  onEscuchando: (manos) => setEstado("escuchando", manos ? 'ESPERANDO "JARVIS"' : "ESCUCHANDO"),
  onFinEscucha: () => { if (!ocupado && !voz.hablando) setEstado("", ESTADO_REPOSO()); },
  onInterino: (t) => { $("interim").textContent = t; },
  onOido: (t) => {
    if (t === null) { // dijo solo "Jarvis"
      const r = `¿Sí, ${ajustes.nombre_trato}?`;
      agregarMsg("jarvis", r);
      voz.hablar(r);
      return;
    }
    procesar(t);
  },
  onError: (tipo) => {
    if (tipo === "sin_soporte") agregarMsg("jarvis", `Me temo que este navegador no me permite escucharlo, ${ajustes.nombre_trato}. Pruebe con Chrome.`);
    if (tipo === "sin_permiso") {
      $("chkManos").checked = false;
      agregarMsg("jarvis", `Necesito permiso para usar el micrófono, ${ajustes.nombre_trato}.`);
    }
  },
});

$("reactor").onclick = () => {
  voz.callar();
  if (voz.escuchandoAhora() && !voz.manosLibres) { voz.pararEscucha(); setEstado("", ESTADO_REPOSO()); return; }
  voz.escuchar();
};

$("chkManos").onchange = (e) => {
  voz.activarManosLibres(e.target.checked);
  if (!e.target.checked) setEstado("", "EN LÍNEA");
};

$("form").onsubmit = (e) => {
  e.preventDefault();
  const t = $("txt").value;
  $("txt").value = "";
  procesar(t);
};

// =====================================================================
// AJUSTES
// =====================================================================
function cargarVoces() { llenarVoces(voz.vocesEspanol(), voz.prefs.voz); }
if ("speechSynthesis" in window) speechSynthesis.addEventListener("voiceschanged", cargarVoces);

$("btnConfig").onclick = () => {
  $("cfgNombre").value = ajustes.nombre_trato ?? "señor";
  $("cfgCiudad").value = ajustes.ciudad_base ?? "";
  $("cfgUbicacion").checked = usarUbicacion.get();
  $("cfgRate").value = voz.prefs.rate;
  $("cfgPitch").value = voz.prefs.pitch;
  $("cfgMsg").textContent = "";
  cargarVoces();
  abrirModal();
};

function leerPrefsVoz() {
  voz.prefs.voz = $("cfgVoz").value;
  voz.prefs.rate = parseFloat($("cfgRate").value);
  voz.prefs.pitch = parseFloat($("cfgPitch").value);
}

$("btnProbar").onclick = () => {
  leerPrefsVoz();
  const nombre = $("cfgNombre").value.trim() || "señor";
  voz.hablar(`Todos los sistemas en línea, ${nombre}. A su disposición.`);
};

$("btnGuardar").onclick = async () => {
  leerPrefsVoz();
  voz.prefs.guardar();
  usarUbicacion.set($("cfgUbicacion").checked);
  const nuevo = {
    nombre_trato: $("cfgNombre").value.trim().slice(0, 40) || "señor",
    ciudad_base: $("cfgCiudad").value.trim().slice(0, 80) || null,
  };
  const ciudadCambio = nuevo.ciudad_base !== (ajustes.ciudad_base ?? null);
  try {
    await api.guardarAjustes({ ...nuevo, ciudadCambio });
    ajustes = { ...ajustes, ...nuevo };
    actualizarUbicacion();
    cerrarModal();
  } catch (err) {
    $("cfgMsg").textContent = "No pude guardar: " + err.message;
  }
};

$("btnBorrar").onclick = async () => {
  if (!confirm("¿Borrar toda la conversación guardada? No se puede deshacer.")) return;
  try {
    await api.borrarHistorial();
    limpiarChat();
    cerrarModal();
    agregarMsg("jarvis", `Conversación borrada, ${ajustes.nombre_trato}. Hacemos de cuenta que nunca pasó.`);
  } catch (err) {
    $("cfgMsg").textContent = err.message;
  }
};

$("btnSalir").onclick = async () => {
  voz.activarManosLibres(false);
  voz.callar();
  await auth.cerrarSesion(false);
  cerrarModal();
  await enrutar();
};

$("btnSalirTodo").onclick = async () => {
  if (!confirm("¿Cerrar la sesión en TODOS sus dispositivos?")) return;
  voz.activarManosLibres(false);
  voz.callar();
  await auth.cerrarSesion(true);
  cerrarModal();
  await enrutar();
};

$("btnCerrarModal").onclick = cerrarModal;
$("modal").onclick = (e) => { if (e.target.id === "modal") cerrarModal(); };
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("modal").hidden) cerrarModal(); });

// Si la sesión se cierra desde otro lado (p. ej. "cerrar en todos"), volver al login
sb?.auth.onAuthStateChange((evento) => {
  if (evento === "SIGNED_OUT") { voz.activarManosLibres(false); voz.callar(); enrutar(); }
});

// =====================================================================
// PWA
// =====================================================================
if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => { /* sin modo instalable, la app funciona igual */ });
}

iniciar();
