// =====================================================================
// J.A.R.V.I.S. · Pantallas Memoria y Actividad
// Autor: Maldonado Jorge Matias
//
// Todo el texto (recuerdos, perfil, nombres, registros) se muestra con
// textContent. Crear y editar recuerdos pasa por el servidor, que valida
// que no se guarden datos prohibidos; borrar va directo (la RLS asegura
// que solo el dueño borre lo suyo).
// =====================================================================

import * as api from "./api.js";
import { $, el, fechaCorta } from "./ui.js";

const CATEGORIAS = { persona: "Persona", proyecto: "Proyecto", preferencia: "Preferencia", dato: "Dato" };
const CLASE_BOTON = "border border-cyan-800 rounded px-2 py-1 text-xs text-cyan-300 disabled:opacity-50";
const CLASE_BOTON_ROJO = "border border-red-900 rounded px-2 py-1 text-xs text-red-300 disabled:opacity-50";
const CLASE_CAMPO = "w-full bg-slate-950 border border-cyan-800 rounded px-2 py-2 text-cyan-100 outline-none focus:border-cyan-400";

function selectorCategoria(valor = "dato") {
  const s = el("select", "bg-slate-950 border border-cyan-800 rounded px-2 py-1 text-xs");
  for (const [k, v] of Object.entries(CATEGORIAS)) {
    const o = new Option(v, k);
    o.selected = k === valor;
    s.append(o);
  }
  return s;
}

function aviso(id, texto, error = false) {
  const p = $(id);
  p.textContent = texto;
  p.className = "text-xs min-h-4 " + (error ? "text-red-300" : "text-cyan-500");
}

// =====================================================================
// MEMORIA
// =====================================================================
let recuerdos = [];

export async function cargarMemoria() {
  aviso("memMsg", "Cargando…");
  try {
    const [perfil, lista, nombres] = await Promise.all([api.leerPerfil(), api.listarMemorias(), api.listarSeudonimos()]);
    $("perfilTexto").value = perfil;
    recuerdos = lista;
    dibujarRecuerdos();
    dibujarSeudonimos(nombres);
    aviso("memMsg", "");
  } catch (e) {
    aviso("memMsg", e.message, true);
  }
}

// ---------------- Perfil ----------------
$("btnPerfil").onclick = async () => {
  const b = $("btnPerfil");
  b.disabled = true;
  aviso("perfilMsg", "Guardando…");
  try {
    await api.guardarPerfil($("perfilTexto").value);
    aviso("perfilMsg", "Perfil guardado.");
  } catch (e) {
    aviso("perfilMsg", e.message, true);
  } finally { b.disabled = false; }
};

// ---------------- Recuerdos ----------------
function dibujarRecuerdos() {
  const filtro = $("memFiltro").value.trim().toLowerCase();
  const lista = $("memLista");
  lista.replaceChildren();
  const visibles = recuerdos.filter((r) => !filtro || r.texto.toLowerCase().includes(filtro));
  $("memCuenta").textContent = recuerdos.length ? `(${recuerdos.length})` : "";
  if (!visibles.length) {
    lista.append(el("p", "text-xs text-cyan-700", recuerdos.length ? "Nada coincide con la búsqueda." : "Todavía no hay recuerdos. Contale cosas a Jarvis o agregalas acá."));
    return;
  }
  for (const r of visibles) lista.append(itemRecuerdo(r));
}

function itemRecuerdo(r) {
  const caja = el("div", "bg-slate-900/80 border border-cyan-900 rounded-lg px-3 py-2 space-y-1");
  const texto = el("p", "text-sm text-cyan-100 whitespace-pre-wrap break-words", r.texto);
  const meta = el("p", "text-[11px] text-cyan-600",
    `${CATEGORIAS[r.categoria] ?? r.categoria} · ${fechaCorta(r.creado)} · ${r.fuente === "manual" ? "cargado a mano" : "desde la charla"}`);
  const botones = el("div", "flex gap-2 justify-end");
  const editar = el("button", CLASE_BOTON, "Editar");
  const borrar = el("button", CLASE_BOTON_ROJO, "Borrar");
  botones.append(editar, borrar);
  caja.append(texto, meta, botones);

  borrar.onclick = async () => {
    if (!confirm("¿Borrar este recuerdo? Jarvis lo olvida definitivamente.")) return;
    borrar.disabled = true;
    try {
      await api.borrarMemoria(r.id);
      recuerdos = recuerdos.filter((x) => x.id !== r.id);
      dibujarRecuerdos();
    } catch (e) { alert(e.message); borrar.disabled = false; }
  };

  editar.onclick = () => {
    const area = el("textarea", CLASE_CAMPO + " text-sm");
    area.value = r.texto;
    area.maxLength = 1000;
    area.rows = 3;
    const cat = selectorCategoria(r.categoria);
    const guardar = el("button", "bg-cyan-600 text-slate-950 font-bold rounded px-3 py-1 text-xs disabled:opacity-50", "Guardar");
    const cancelar = el("button", CLASE_BOTON, "Cancelar");
    const msg = el("p", "text-xs text-red-300 min-h-4");
    const fila = el("div", "flex gap-2 items-center justify-end");
    fila.append(cat, cancelar, guardar);
    caja.replaceChildren(area, fila, msg);
    area.focus();
    cancelar.onclick = () => caja.replaceWith(itemRecuerdo(r));
    guardar.onclick = async () => {
      guardar.disabled = true;
      msg.textContent = "";
      try {
        await api.editarMemoria(r.id, area.value.trim(), cat.value);
        Object.assign(r, { texto: area.value.trim().replace(/\s+/g, " "), categoria: cat.value });
        caja.replaceWith(itemRecuerdo(r));
      } catch (e) { msg.textContent = e.message; guardar.disabled = false; }
    };
  };
  return caja;
}

$("memFiltro").oninput = dibujarRecuerdos;

$("formMemNueva").onsubmit = async (e) => {
  e.preventDefault();
  const texto = $("memNuevaTexto").value.trim();
  if (texto.length < 3) return;
  const b = e.target.querySelector("button");
  b.disabled = true;
  aviso("memNuevaMsg", "Guardando…");
  try {
    const r = await api.crearMemoria(texto, $("memNuevaCat").value);
    $("memNuevaTexto").value = "";
    aviso("memNuevaMsg", r.accion === "actualizada" ? "Ya había un recuerdo casi igual: lo actualicé." : "Recuerdo guardado.");
    recuerdos = await api.listarMemorias();
    dibujarRecuerdos();
  } catch (err) {
    aviso("memNuevaMsg", err.message, true);
  } finally { b.disabled = false; }
};

// ---------------- Nombres protegidos ----------------
function dibujarSeudonimos(nombres) {
  const lista = $("seudLista");
  lista.replaceChildren();
  if (!nombres.length) {
    lista.append(el("p", "text-xs text-cyan-700", "Todavía no hay nombres protegidos."));
    return;
  }
  for (const n of nombres) {
    const fila = el("div", "flex items-start justify-between gap-2 bg-slate-900/80 border border-cyan-900 rounded-lg px-3 py-2");
    const info = el("div", "min-w-0");
    info.append(el("p", "text-sm text-cyan-100 break-words", n.valor));
    const extra = [n.tipo === "PERSONA" ? "Persona" : n.tipo === "LUGAR" ? "Lugar" : "Organización", `código [${n.tipo}_${n.id}]`];
    if (n.alias?.length) extra.push("también: " + n.alias.join(", "));
    info.append(el("p", "text-[11px] text-cyan-600 break-words", extra.join(" · ")));
    const borrar = el("button", CLASE_BOTON_ROJO + " shrink-0", "Quitar");
    borrar.onclick = async () => {
      if (!confirm(`¿Dejar de proteger "${n.valor}"? A partir de ahora llegaría a Gemini con su nombre real.`)) return;
      borrar.disabled = true;
      try { await api.borrarSeudonimo(n.id); dibujarSeudonimos(await api.listarSeudonimos()); } catch (e) { alert(e.message); borrar.disabled = false; }
    };
    fila.append(info, borrar);
    lista.append(fila);
  }
}

$("formSeud").onsubmit = async (e) => {
  e.preventDefault();
  const valor = $("seudValor").value.trim().replace(/\s+/g, " ");
  if (valor.length < 2) return;
  const alias = $("seudAlias").value.split(",").map((x) => x.trim()).filter((x) => x.length >= 2).slice(0, 10);
  const b = e.target.querySelector("button");
  b.disabled = true;
  aviso("seudMsg", "Guardando…");
  try {
    await api.agregarSeudonimo({ tipo: $("seudTipo").value, valor: valor.slice(0, 120), alias });
    $("seudValor").value = "";
    $("seudAlias").value = "";
    aviso("seudMsg", "Protegido. Desde ahora Gemini solo ve el código.");
    dibujarSeudonimos(await api.listarSeudonimos());
  } catch (err) {
    aviso("seudMsg", err.message, true);
  } finally { b.disabled = false; }
};

// =====================================================================
// ACTIVIDAD
// =====================================================================
const NOMBRES_TIPO = {
  chat: "Consulta", herramienta: "Herramienta", acceso_denegado: "Acceso denegado", limite: "Límite alcanzado",
  memoria: "Memoria", propuesta: "Acción propuesta", confirmacion: "Confirmación",
};
const NOMBRES_HERRAMIENTA = {
  obtener_clima: "clima", guardar_memoria: "guardar recuerdo", buscar_memorias: "buscar recuerdos",
  olvidar_memoria: "olvidar", olvidar_memorias: "olvidar recuerdos", memoria_crear: "recuerdo agregado a mano",
  memoria_editar: "recuerdo editado", perfil_guardar: "perfil guardado",
};

function resumenActividad(a) {
  const p = a.parametros ?? {}, r = a.resultado ?? {};
  if (a.tipo === "chat" && a.ok) {
    const partes = [`${p.llamadas_llm ?? "?"} llamada(s) al modelo`];
    if (p.herramientas?.length) partes.push("usó " + p.herramientas.map((h) => NOMBRES_HERRAMIENTA[h] ?? h).join(", "));
    if (p.recuerdos_usados) partes.push(`${p.recuerdos_usados} recuerdo(s)`);
    if (p.datos_seudonimizados) partes.push(`${p.datos_seudonimizados} dato(s) protegidos`);
    if (p.ms) partes.push(`${(p.ms / 1000).toFixed(1)} s`);
    return partes.join(" · ");
  }
  if (a.tipo === "confirmacion") return r.estado === "confirmada" ? "confirmada" + (r.borrados != null ? ` · ${r.borrados} borrado(s)` : "") : r.estado ?? "";
  if (a.tipo === "propuesta") return p.resumen ?? "";
  if (a.tipo === "acceso_denegado") return p.motivo ?? "";
  return r.error ?? "";
}

export async function cargarActividad() {
  const lista = $("actLista");
  lista.replaceChildren(el("p", "text-xs text-cyan-600", "Cargando…"));
  try {
    const filas = await api.listarActividad(80);
    lista.replaceChildren();
    if (!filas.length) { lista.append(el("p", "text-xs text-cyan-700", "Sin actividad todavía.")); return; }
    for (const a of filas) {
      const fila = el("div", "border-b border-cyan-950 py-2");
      const linea = el("div", "flex items-baseline gap-2 text-sm");
      linea.append(el("span", a.ok ? "text-cyan-400" : "text-red-400", a.ok ? "✓" : "✗"));
      const titulo = (NOMBRES_TIPO[a.tipo] ?? a.tipo) + (a.herramienta ? ` · ${NOMBRES_HERRAMIENTA[a.herramienta] ?? a.herramienta}` : "");
      linea.append(el("span", "text-cyan-100 flex-1 min-w-0 truncate", titulo));
      linea.append(el("span", "text-[11px] text-cyan-700 shrink-0", `${fechaCorta(a.creado)}${a.canal ? " · " + a.canal : ""}`));
      fila.append(linea);
      const resumen = resumenActividad(a);
      if (resumen) fila.append(el("p", "text-xs text-cyan-600 pl-5 break-words", resumen));
      lista.append(fila);
    }
  } catch (e) {
    lista.replaceChildren(el("p", "text-xs text-red-300", e.message));
  }
}

$("btnActRecargar").onclick = cargarActividad;
