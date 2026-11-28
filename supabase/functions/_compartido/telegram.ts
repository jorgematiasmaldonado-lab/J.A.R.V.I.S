// =====================================================================
// J.A.R.V.I.S. · Cliente del bot de Telegram
// Autor: Maldonado Jorge Matias
//
// - Secret: TELEGRAM_BOT_TOKEN (se obtiene de @BotFather).
// - Los mensajes se envían como texto plano (sin HTML ni Markdown), así
//   nada que venga del modelo puede inyectar formato o enlaces ocultos.
// - parsearActualizacion() es pura y se prueba sin red.
// =====================================================================

// Se puede cambiar solo para pruebas locales (TELEGRAM_API_URL); por defecto, la oficial
const api = () => Deno.env.get("TELEGRAM_API_URL") ?? "https://api.telegram.org";
const MAX_TEXTO = 4000;

export class ErrorTelegram extends Error {}

function token(): string {
  const t = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!t) throw new Error("Falta configurar el secret TELEGRAM_BOT_TOKEN");
  return t;
}

export function telegramConfigurado(): boolean {
  return !!Deno.env.get("TELEGRAM_BOT_TOKEN");
}

async function llamar(metodo: string, cuerpo: Record<string, unknown>): Promise<Record<string, unknown>> {
  const r = await fetch(`${api()}/bot${token()}/${metodo}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(15_000),
  });
  const j = await r.json().catch(() => ({})) as { ok?: boolean; result?: Record<string, unknown>; description?: string };
  // Nunca se incluye la URL (tiene el token) en los errores
  if (!j.ok) throw new ErrorTelegram(`Telegram rechazó ${metodo}: ${j.description ?? r.status}`);
  return j.result ?? {};
}

export interface Boton {
  texto: string;
  datos: string; // máx. 64 bytes
}

export async function enviar(chatId: number, texto: string, botones?: Boton[][]): Promise<number> {
  const r = await llamar("sendMessage", {
    chat_id: chatId,
    text: texto.length > MAX_TEXTO ? texto.slice(0, MAX_TEXTO - 1) + "…" : texto,
    link_preview_options: { is_disabled: true },
    ...(botones?.length ? { reply_markup: { inline_keyboard: botones.map((f) => f.map((b) => ({ text: b.texto, callback_data: b.datos }))) } } : {}),
  });
  return r.message_id as number;
}

export async function escribiendo(chatId: number): Promise<void> {
  await llamar("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
}

export async function responderBoton(callbackId: string, texto: string): Promise<void> {
  await llamar("answerCallbackQuery", { callback_query_id: callbackId, text: texto.slice(0, 190) }).catch(() => {});
}

/** Reemplaza el texto del mensaje y le quita los botones (para que no se toquen dos veces). */
export async function cerrarMensaje(chatId: number, mensajeId: number, texto: string): Promise<void> {
  await llamar("editMessageText", { chat_id: chatId, message_id: mensajeId, text: texto.slice(0, MAX_TEXTO) }).catch(() => {});
}

export async function configurarWebhook(url: string, secreto: string): Promise<void> {
  await llamar("setWebhook", {
    url,
    secret_token: secreto,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
    max_connections: 5,
  });
}

export async function nombreDelBot(): Promise<string> {
  const r = await llamar("getMe", {});
  return String(r.username ?? "");
}

// ---------------------------------------------------------------------
// Lectura de lo que manda Telegram
// ---------------------------------------------------------------------
export type Actualizacion =
  | { tipo: "mensaje"; chatId: number; deId: number; privado: boolean; texto: string | null; esAudio: boolean; esOtro: boolean }
  | { tipo: "boton"; chatId: number; deId: number; callbackId: string; datos: string; mensajeId: number }
  | { tipo: "ignorar" };

// deno-lint-ignore no-explicit-any
export function parsearActualizacion(u: any): Actualizacion {
  if (u?.message?.chat?.id && u.message.from?.id) {
    const m = u.message;
    return {
      tipo: "mensaje",
      chatId: Number(m.chat.id),
      deId: Number(m.from.id),
      privado: m.chat.type === "private",
      texto: typeof m.text === "string" ? m.text : null,
      esAudio: !!(m.voice || m.audio || m.video_note),
      esOtro: typeof m.text !== "string" && !(m.voice || m.audio || m.video_note),
    };
  }
  if (u?.callback_query?.id && u.callback_query.from?.id && u.callback_query.message?.chat?.id) {
    const c = u.callback_query;
    return {
      tipo: "boton",
      chatId: Number(c.message.chat.id),
      deId: Number(c.from.id),
      callbackId: String(c.id),
      datos: String(c.data ?? ""),
      mensajeId: Number(c.message.message_id),
    };
  }
  return { tipo: "ignorar" };
}

/** Compara secretos sin filtrar información por el tiempo de respuesta. */
export function compararSeguro(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b);
  let dif = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) dif |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return dif === 0;
}
