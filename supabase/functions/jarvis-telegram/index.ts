// =====================================================================
// J.A.R.V.I.S. · Edge Function "jarvis-telegram" (webhook del bot)
// Autor: Maldonado Jorge Matias
//
// Seguridad:
//   1. Telegram firma cada llamada con el encabezado
//      X-Telegram-Bot-Api-Secret-Token (secreto generado en la base).
//   2. Solo se atiende el chat privado vinculado al dueño. Cualquier otro
//      se ignora (sin responder) y queda en `actividad`.
//   3. El vínculo se hace con un código de un solo uso generado desde la
//      app (con sesión y MFA), que vence a los 15 minutos.
//   4. Las acciones sensibles se confirman con botones; los audios no se
//      procesan (no se pueden seudonimizar antes de transcribirlos).
// =====================================================================

import { ErrorConfirmacion, resolver } from "../_compartido/confirmaciones.ts";
import { conversar, ErrorConversacion, prepararConversacion } from "../_compartido/conversacion.ts";
import type { AccionPendiente } from "../_compartido/confirmaciones.ts";
import { sha256Hex } from "../_compartido/google.ts";
import { admin, registrarActividad } from "../_compartido/seguridad.ts";
import { cerrarMensaje, compararSeguro, enviar, escribiendo, parsearActualizacion, responderBoton } from "../_compartido/telegram.ts";

const ok = () => new Response("ok", { status: 200 });

Deno.serve(async (req) => {
  try {
    return await atender(req);
  } catch (e) {
    // Siempre 200 para que Telegram no reintente en bucle; el error queda en los registros
    console.error("jarvis-telegram:", (e as Error).message);
    return ok();
  }
});

async function atender(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("no", { status: 405 });
  const db = admin();
  const { data: c } = await db.from("config_privada").select("secreto_telegram").eq("id", 1).maybeSingle();
  if (!c || !compararSeguro(req.headers.get("x-telegram-bot-api-secret-token") ?? "", c.secreto_telegram)) {
    return new Response("no autorizado", { status: 401 });
  }

  const crudo = await req.text();
  if (crudo.length > 64_000) return ok();
  const u = parsearActualizacion(JSON.parse(crudo));
  if (u.tipo === "ignorar") return ok();

  const { data: dueno } = await db.from("dueno").select("user_id").limit(1).maybeSingle();
  if (!dueno) return ok();
  const userId = dueno.user_id as string;
  const { data: aj } = await db.from("ajustes").select("telegram_chat_id, nombre_trato").eq("user_id", userId).maybeSingle();
  const chatDueno = aj?.telegram_chat_id ? Number(aj.telegram_chat_id) : null;
  const nombre = aj?.nombre_trato ?? "señor";

  // ---------------- Vincular con /start CODIGO ----------------
  if (u.tipo === "mensaje" && u.privado && u.deId === u.chatId && u.texto?.startsWith("/start ")) {
    const codigo = u.texto.slice(7).trim();
    if (/^[A-Za-z0-9_-]{8,64}$/.test(codigo)) {
      const hash = await sha256Hex(codigo);
      const { data: v } = await db.from("telegram_vinculos").delete().eq("codigo_hash", hash).gt("vence", new Date().toISOString()).select("user_id");
      if (v?.length && v[0].user_id === userId) {
        await db.from("ajustes").upsert({ user_id: userId, telegram_chat_id: u.chatId }, { onConflict: "user_id" });
        await db.from("telegram_vinculos").delete().eq("user_id", userId);
        await registrarActividad(userId, { tipo: "vinculo", herramienta: "telegram", canal: "telegram" });
        await enviar(u.chatId, `Listo, ${nombre}. A partir de ahora también lo atiendo por acá y le aviso sus recordatorios.`);
        return ok();
      }
    }
  }

  // ---------------- Solo el dueño ----------------
  const esDueno = chatDueno !== null && u.chatId === chatDueno && u.deId === chatDueno;
  if (!esDueno || (u.tipo === "mensaje" && !u.privado)) {
    await registrarActividad(null, { tipo: "acceso_denegado", canal: "telegram", ok: false, parametros: { motivo: "chat_no_autorizado" } });
    return ok(); // sin respuesta: un extraño no sabe ni que el bot existe
  }

  // ---------------- Botones ----------------
  if (u.tipo === "boton") {
    const [accion, id] = u.datos.split(":");
    if (accion === "ok" && /^\d+$/.test(id ?? "")) {
      const { data } = await db.from("recordatorios").update({ estado: "confirmado", confirmado: new Date().toISOString(), proximo_aviso: null })
        .eq("id", Number(id)).eq("user_id", userId).in("estado", ["pendiente", "avisado"]).select("texto");
      await responderBoton(u.callbackId, data?.length ? "Entendido" : "Ya estaba confirmado");
      if (data?.length) await cerrarMensaje(u.chatId, u.mensajeId, `✅ ${data[0].texto}`);
      return ok();
    }
    if ((accion === "si" || accion === "no") && /^[0-9a-f-]{36}$/.test(id ?? "")) {
      try {
        const r = await resolver(userId, id, accion === "si", "telegram");
        const n = (r.resultado?.borrados ?? r.resultado?.cancelados) as number | undefined;
        const texto = r.estado === "cancelada" ? "Cancelado. No se hizo nada." : `Hecho${n != null ? `: ${n} elemento(s)` : ""}.`;
        await responderBoton(u.callbackId, texto);
        await cerrarMensaje(u.chatId, u.mensajeId, (r.estado === "cancelada" ? "✖️ " : "✅ ") + texto);
      } catch (e) {
        await responderBoton(u.callbackId, e instanceof ErrorConfirmacion ? e.message : "No se pudo");
      }
      return ok();
    }
    await responderBoton(u.callbackId, "Botón desconocido");
    return ok();
  }

  // ---------------- Mensajes ----------------
  if (u.esAudio) {
    await enviar(u.chatId, `Por privacidad todavía no proceso audios, ${nombre}: los nombres llegarían sin proteger. Dícteme con el micrófono del teclado y le respondo enseguida.`);
    return ok();
  }
  if (!u.texto || u.esOtro) {
    await enviar(u.chatId, "Por ahora solo leo mensajes de texto.");
    return ok();
  }
  if (u.texto === "/start") {
    await enviar(u.chatId, `A su disposición, ${nombre}.`);
    return ok();
  }

  await escribiendo(u.chatId);
  const pendientes: AccionPendiente[] = [];
  try {
    const p = await prepararConversacion(userId, "telegram");
    const r = await conversar(p, { mensaje: u.texto.slice(0, 2000), onConfirmacion: (a) => pendientes.push(a) });
    await enviar(u.chatId, r.texto);
    for (const a of pendientes) {
      const detalle = a.detalle.length ? "\n" + a.detalle.map((d) => `• ${d}`).join("\n") : "";
      await enviar(u.chatId, `🔒 Requiere su confirmación: ${a.resumen}${detalle}`, [[
        { texto: "✅ Confirmar", datos: `si:${a.id}` }, { texto: "✖️ Cancelar", datos: `no:${a.id}` },
      ]]);
    }
    if (r.aviso) await enviar(u.chatId, `ℹ️ ${r.aviso}`);
  } catch (e) {
    await enviar(u.chatId, `Disculpe, ${nombre}, ${e instanceof ErrorConversacion ? e.message : "tuve un inconveniente interno"}.`);
  }
  return ok();
}
