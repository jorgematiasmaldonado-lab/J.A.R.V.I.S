// =====================================================================
// J.A.R.V.I.S. · Pruebas de Telegram y Google (sin red)
// Autor: Maldonado Jorge Matias
// =====================================================================

import { assert, assertEquals } from "jsr:@std/assert@1.0.13";
import { compararSeguro, enviar, parsearActualizacion } from "../_compartido/telegram.ts";
import { ALCANCE, pkce, sha256Hex, urlAutorizacion } from "../_compartido/google.ts";

Deno.test("Telegram: lee mensajes de texto, audios y botones", () => {
  const texto = parsearActualizacion({ update_id: 1, message: { message_id: 5, from: { id: 42 }, chat: { id: 42, type: "private" }, text: "hola" } });
  assertEquals(texto, { tipo: "mensaje", chatId: 42, deId: 42, privado: true, texto: "hola", esAudio: false, esOtro: false });

  const audio = parsearActualizacion({ message: { from: { id: 42 }, chat: { id: 42, type: "private" }, voice: { file_id: "x" } } });
  assert(audio.tipo === "mensaje" && audio.esAudio && audio.texto === null);

  const grupo = parsearActualizacion({ message: { from: { id: 42 }, chat: { id: -100, type: "group" }, text: "hola" } });
  assert(grupo.tipo === "mensaje" && !grupo.privado);

  const boton = parsearActualizacion({ callback_query: { id: "cb1", from: { id: 42 }, data: "si:abc", message: { message_id: 9, chat: { id: 42 } } } });
  assertEquals(boton, { tipo: "boton", chatId: 42, deId: 42, callbackId: "cb1", datos: "si:abc", mensajeId: 9 });

  assertEquals(parsearActualizacion({ edited_message: {} }).tipo, "ignorar");
  assertEquals(parsearActualizacion(null).tipo, "ignorar");
});

Deno.test("Telegram: comparación de secretos", () => {
  assert(compararSeguro("abc123", "abc123"));
  assert(!compararSeguro("abc123", "abc124"));
  assert(!compararSeguro("abc", "abc123"));
  assert(!compararSeguro("", "x"));
});

Deno.test("Telegram: texto plano, recortado y con botones; el token nunca aparece en errores", async () => {
  const original = globalThis.fetch;
  Deno.env.set("TELEGRAM_BOT_TOKEN", "123:TOKEN-DE-PRUEBA");
  let cuerpo: Record<string, unknown> = {};
  let url = "";
  globalThis.fetch = ((u: string, init: RequestInit) => {
    url = u;
    cuerpo = JSON.parse(init.body as string);
    return Promise.resolve(new Response(JSON.stringify({ ok: true, result: { message_id: 77 } })));
  }) as typeof fetch;
  try {
    const id = await enviar(42, "x".repeat(5000), [[{ texto: "Entendido", datos: "ok:1" }]]);
    assertEquals(id, 77);
    assert(url.endsWith("/sendMessage"));
    assertEquals((cuerpo.text as string).length, 4000);
    assertEquals(cuerpo.parse_mode, undefined); // nunca HTML ni Markdown
    assertEquals(cuerpo.reply_markup, { inline_keyboard: [[{ text: "Entendido", callback_data: "ok:1" }]] });

    globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify({ ok: false, description: "Bad Request" }), { status: 400 }))) as typeof fetch;
    try { await enviar(42, "hola"); } catch (e) { assert(!(e as Error).message.includes("TOKEN-DE-PRUEBA")); }
  } finally {
    globalThis.fetch = original;
    Deno.env.delete("TELEGRAM_BOT_TOKEN");
  }
});

Deno.test("Google: URL de autorización con PKCE, permiso mínimo y acceso permanente", async () => {
  const { verificador, desafio } = await pkce();
  assert(verificador.length >= 43 && /^[A-Za-z0-9_-]+$/.test(verificador));
  assert(/^[A-Za-z0-9_-]{43}$/.test(desafio));
  assert(desafio !== verificador);

  const u = new URL(urlAutorizacion({ clientId: "cliente", redirect: "https://x.supabase.co/functions/v1/jarvis-google", estado: "est", desafio }));
  assertEquals(u.origin + u.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assertEquals(u.searchParams.get("scope"), ALCANCE);
  assertEquals(u.searchParams.get("scope"), "https://www.googleapis.com/auth/calendar.events");
  assertEquals(u.searchParams.get("access_type"), "offline");
  assertEquals(u.searchParams.get("code_challenge_method"), "S256");
  assertEquals(u.searchParams.get("code_challenge"), desafio);
  assertEquals(u.searchParams.get("state"), "est");
  assertEquals(u.searchParams.get("client_secret"), null); // el secreto nunca va al navegador
});

Deno.test("hash SHA-256 de los códigos de un solo uso", async () => {
  assertEquals(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
