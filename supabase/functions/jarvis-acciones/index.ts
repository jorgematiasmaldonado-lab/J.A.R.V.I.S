// =====================================================================
// J.A.R.V.I.S. · Edge Function "jarvis-acciones"
// Autor: Maldonado Jorge Matias
//
// Lo que la app hace "a mano" y no puede hacer directo en la base:
//   memoria_crear    { texto, categoria }        (calcula el vector)
//   memoria_editar   { id, texto, categoria }    (recalcula el vector)
//   perfil_guardar   { texto }
//   confirmar        { id }   ← única forma de ejecutar una acción sensible
//   cancelar         { id }
//   tarea_crear      { titulo, vence?, prioridad? }
//   agenda_hoy       {}       eventos de hoy y mañana (Google Calendar)
//   conexiones       {}       estado de Google y Telegram
//   telegram_codigo  {}       activa el bot y da un código de vínculo de un solo uso
//   telegram_desvincular {}
//   resumen_ahora    {}       genera (y envía) el resumen del día
// Misma seguridad que jarvis-chat: CORS, JWT, email, MFA (aal2), dueño,
// límites y validación estricta. Todo queda en `actividad`.
// =====================================================================

import { ErrorConfirmacion, resolver } from "../_compartido/confirmaciones.ts";
import { aleatorio, Calendario, ErrorGoogle, sha256Hex } from "../_compartido/google.ts";
import { AJUSTES_POR_DEFECTO, type Ajustes, COLUMNAS_AJUSTES } from "../_compartido/herramientas/tipos.ts";
import { generarResumen } from "../_compartido/resumen.ts";
import { configurarWebhook, ErrorTelegram, nombreDelBot, telegramConfigurado } from "../_compartido/telegram.ts";
import { describirCuando, hoyLocal, localAUtc, sumarDias, utcALocal } from "../_compartido/tiempo.ts";
import { motivoProhibido } from "../_compartido/memoria.ts";
import { crearEmbeddings } from "../_compartido/llm/embeddings.ts";
import { ErrorLLM } from "../_compartido/llm/tipos.ts";
import { CATEGORIAS, type Categoria, editarMemoria, ErrorMemoria, guardarMemoria, guardarPerfil } from "../_compartido/memoria.ts";
import {
  admin, config, consumirCupo, encabezadosCors, ErrorAcceso, origenPermitido, registrarActividad, respuestaJson,
  verificarUsuario,
} from "../_compartido/seguridad.ts";
import { type EntradaSeudonimo, Seudonimizador } from "../_compartido/seudonimizar.ts";
import { ErrorValidacion, type Esquema, validar } from "../_compartido/validar.ts";

const TAMANO_MAXIMO = 8_000;

const ESQUEMAS: Record<string, Esquema> = {
  memoria_crear: {
    type: "object",
    properties: {
      accion: { type: "string" },
      texto: { type: "string", minLength: 3, maxLength: 1000 },
      categoria: { type: "string", enum: [...CATEGORIAS] },
    },
    required: ["accion", "texto", "categoria"],
  },
  memoria_editar: {
    type: "object",
    properties: {
      accion: { type: "string" },
      id: { type: "integer", minimum: 1 },
      texto: { type: "string", minLength: 3, maxLength: 1000 },
      categoria: { type: "string", enum: [...CATEGORIAS] },
    },
    required: ["accion", "id", "texto", "categoria"],
  },
  perfil_guardar: {
    type: "object",
    properties: { accion: { type: "string" }, texto: { type: "string", maxLength: 2000 } },
    required: ["accion", "texto"],
  },
  confirmar: {
    type: "object",
    properties: { accion: { type: "string" }, id: { type: "string", minLength: 36, maxLength: 36 } },
    required: ["accion", "id"],
  },
  cancelar: {
    type: "object",
    properties: { accion: { type: "string" }, id: { type: "string", minLength: 36, maxLength: 36 } },
    required: ["accion", "id"],
  },
  tarea_crear: {
    type: "object",
    properties: {
      accion: { type: "string" },
      titulo: { type: "string", minLength: 2, maxLength: 300 },
      vence: { type: "string", minLength: 10, maxLength: 10 },
      prioridad: { type: "integer", minimum: 1, maximum: 3 },
    },
    required: ["accion", "titulo"],
  },
  agenda_hoy: { type: "object", properties: { accion: { type: "string" } }, required: ["accion"] },
  conexiones: { type: "object", properties: { accion: { type: "string" } }, required: ["accion"] },
  telegram_codigo: { type: "object", properties: { accion: { type: "string" } }, required: ["accion"] },
  telegram_desvincular: { type: "object", properties: { accion: { type: "string" } }, required: ["accion"] },
  resumen_ahora: { type: "object", properties: { accion: { type: "string" } }, required: ["accion"] },
};

async function leerAjustes(userId: string): Promise<Ajustes> {
  const { data } = await admin().from("ajustes").select(COLUMNAS_AJUSTES).eq("user_id", userId).maybeSingle();
  return { ...AJUSTES_POR_DEFECTO, ...(data ?? {}) };
}

Deno.serve(async (req) => {
  try {
    return await atender(req);
  } catch (e) {
    const msg = (e as Error).message ?? "";
    console.error("jarvis-acciones:", msg);
    const configuracion = msg.startsWith("Falta configurar");
    return new Response(JSON.stringify({ error: configuracion ? "configuracion_incompleta" : "error_interno" }), {
      status: configuracion ? 503 : 500,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
});

async function atender(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: origenPermitido(req) ? 204 : 403, headers: encabezadosCors(req) });
  }
  if (!origenPermitido(req)) return respuestaJson(req, 403, { error: "origen_no_permitido" });
  if (req.method !== "POST") return respuestaJson(req, 405, { error: "metodo_no_permitido" });

  let userId: string;
  try {
    userId = (await verificarUsuario(req, "web")).id;
  } catch (e) {
    if (e instanceof ErrorAcceso) return respuestaJson(req, e.estado, { error: e.codigo, mensaje: e.message });
    throw e;
  }

  // --- Cuerpo ------------------------------------------------------------
  let p: Record<string, unknown>;
  try {
    const crudo = await req.text();
    if (crudo.length > TAMANO_MAXIMO) return respuestaJson(req, 413, { error: "mensaje_demasiado_grande" });
    const json = JSON.parse(crudo);
    const esquema = ESQUEMAS[json?.accion];
    if (!esquema) return respuestaJson(req, 400, { error: "peticion_invalida", mensaje: "acción desconocida" });
    p = validar(json, esquema) as Record<string, unknown>;
  } catch (e) {
    const msg = e instanceof ErrorValidacion ? e.message : "JSON inválido";
    return respuestaJson(req, 400, { error: "peticion_invalida", mensaje: msg });
  }

  // --- Límite ------------------------------------------------------------
  const { data: aj } = await admin().from("ajustes").select("zona_horaria").eq("user_id", userId).maybeSingle();
  const zona = aj?.zona_horaria ?? "America/Argentina/Cordoba";
  const cupo = await consumirCupo(userId, "accion", config.limiteAccionesMinuto, config.limiteAccionesDia, zona);
  if (!cupo.permitido) return respuestaJson(req, 429, { error: "limite", mensaje: "Demasiadas acciones seguidas." });

  const accion = p.accion as string;
  try {
    switch (accion) {
      case "memoria_crear":
      case "memoria_editar": {
        const emb = crearEmbeddings();
        if (!emb) return respuestaJson(req, 503, { error: "configuracion_incompleta" });
        const { data: lista } = await admin().from("seudonimos").select("id, tipo, valor, alias").eq("user_id", userId);
        const deps = {
          userId, emb, canal: "web",
          seud: new Seudonimizador((lista ?? []) as EntradaSeudonimo[]),
          contarEmb: async () => {
            const c = await consumirCupo(userId, "emb", 60, config.limiteEmbDia, zona);
            if (!c.permitido) throw new ErrorMemoria("se alcanzó el tope diario de la memoria");
          },
        };
        if (accion === "memoria_crear") {
          const r = await guardarMemoria(deps, { texto: p.texto as string, categoria: p.categoria as Categoria, fuente: "manual" });
          await registrarActividad(userId, { tipo: "memoria", herramienta: "memoria_crear", canal: "web", resultado: r });
          return respuestaJson(req, 200, { ok: true, ...r });
        }
        await editarMemoria(deps, { id: p.id as number, texto: p.texto as string, categoria: p.categoria as Categoria });
        await registrarActividad(userId, { tipo: "memoria", herramienta: "memoria_editar", canal: "web", parametros: { id: p.id } });
        return respuestaJson(req, 200, { ok: true });
      }
      case "perfil_guardar":
        await guardarPerfil(userId, p.texto as string);
        await registrarActividad(userId, { tipo: "memoria", herramienta: "perfil_guardar", canal: "web" });
        return respuestaJson(req, 200, { ok: true });
      case "confirmar":
      case "cancelar": {
        const r = await resolver(userId, p.id as string, accion === "confirmar", "web");
        return respuestaJson(req, 200, { ok: true, ...r });
      }
      case "tarea_crear": {
        const m = motivoProhibido(p.titulo as string);
        if (m) throw new ErrorMemoria(`no lo guardo por seguridad: ${m}`);
        if (p.vence) {
          try { localAUtc(p.vence as string, zona); } catch { throw new ErrorMemoria("la fecha no es válida"); }
        }
        const { error } = await admin().from("tareas").insert({
          user_id: userId, titulo: (p.titulo as string).trim(), vence: p.vence ?? null, prioridad: p.prioridad ?? 2, canal: "web",
        });
        if (error) throw new Error("crear tarea: " + error.message);
        return respuestaJson(req, 200, { ok: true });
      }
      case "agenda_hoy": {
        const aj = await leerAjustes(userId);
        if (!aj.google_conectado) return respuestaJson(req, 200, { conectado: false, eventos: [] });
        const hoy = hoyLocal(zona);
        const eventos = await new Calendario(userId).listar(localAUtc(hoy, zona), localAUtc(sumarDias(hoy, 2), zona));
        return respuestaJson(req, 200, {
          conectado: true,
          eventos: eventos.map((e) => ({
            titulo: e.titulo, lugar: e.lugar, todoElDia: e.todoElDia,
            dia: e.todoElDia ? (e.inicio === hoy ? "hoy" : "mañana") : (utcALocal(new Date(e.inicio), zona).fecha === hoy ? "hoy" : "mañana"),
            hora: e.todoElDia ? null : utcALocal(new Date(e.inicio), zona).hora,
            cuando: e.todoElDia ? null : describirCuando(new Date(e.inicio), zona),
          })),
        });
      }
      case "conexiones": {
        const aj = await leerAjustes(userId);
        return respuestaJson(req, 200, {
          google: aj.google_conectado,
          google_configurado: !!(Deno.env.get("GOOGLE_CLIENT_ID") && Deno.env.get("GOOGLE_CLIENT_SECRET") && Deno.env.get("APP_URL")),
          telegram: !!aj.telegram_chat_id,
          telegram_configurado: telegramConfigurado(),
        });
      }
      case "telegram_codigo": {
        if (!telegramConfigurado()) return respuestaJson(req, 503, { error: "configuracion_incompleta", mensaje: "Falta cargar TELEGRAM_BOT_TOKEN en Supabase." });
        // (Re)configura el webhook con el secreto generado en la base
        const { data: c } = await admin().from("config_privada").select("secreto_telegram").eq("id", 1).single();
        await configurarWebhook(`${Deno.env.get("SUPABASE_URL")!.replace(/\/$/, "")}/functions/v1/jarvis-telegram`, c!.secreto_telegram);
        const codigo = aleatorio(12);
        await admin().from("telegram_vinculos").delete().eq("user_id", userId);
        await admin().from("telegram_vinculos").insert({ codigo_hash: await sha256Hex(codigo), user_id: userId });
        const bot = await nombreDelBot();
        await registrarActividad(userId, { tipo: "vinculo", herramienta: "telegram_codigo", canal: "web" });
        return respuestaJson(req, 200, { codigo, bot, enlace: `https://t.me/${bot}?start=${codigo}` });
      }
      case "telegram_desvincular": {
        await admin().from("ajustes").update({ telegram_chat_id: null }).eq("user_id", userId);
        await registrarActividad(userId, { tipo: "vinculo", herramienta: "telegram_desvinculado", canal: "web" });
        return respuestaJson(req, 200, { ok: true });
      }
      case "resumen_ahora": {
        const aj = await leerAjustes(userId);
        const texto = await generarResumen(userId, aj, { enviarTelegram: !!aj.telegram_chat_id });
        return respuestaJson(req, 200, { ok: true, texto });
      }
    }
  } catch (e) {
    if (e instanceof ErrorMemoria || e instanceof ErrorConfirmacion || e instanceof ErrorLLM || e instanceof ErrorGoogle || e instanceof ErrorTelegram) {
      return respuestaJson(req, 422, { error: "no_se_pudo", mensaje: e.message });
    }
    throw e;
  }
  return respuestaJson(req, 400, { error: "peticion_invalida" });
}
