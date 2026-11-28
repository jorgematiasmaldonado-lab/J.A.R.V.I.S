// =====================================================================
// J.A.R.V.I.S. · Edge Function "jarvis-google" (conectar Google Calendar)
// Autor: Maldonado Jorge Matias
//
//   POST { accion: "iniciar" }      (app, con sesión aal2) → { url } de Google
//   GET  ?code=…&state=…            (Google vuelve acá)    → guarda el permiso
//   POST { accion: "desconectar" }  (app, con sesión aal2) → revoca y borra
//
// Seguridad: "state" aleatorio de un solo uso (anti-CSRF) atado al dueño,
// PKCE, permiso mínimo (calendar.events) y refresh token en Vault.
// Secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, APP_URL.
// =====================================================================

import { aleatorio, canjearCodigo, pkce, revocar, sha256Hex, urlAutorizacion, urlRetorno } from "../_compartido/google.ts";
import {
  admin, encabezadosCors, ErrorAcceso, origenPermitido, registrarActividad, respuestaJson, verificarUsuario,
} from "../_compartido/seguridad.ts";

function requerida(nombre: string): string {
  const v = Deno.env.get(nombre);
  if (!v) throw new Error(`Falta configurar el secret ${nombre}`);
  return v;
}

function volverALaApp(resultado: "ok" | "error" | "cancelado"): Response {
  const url = new URL(requerida("APP_URL"));
  url.searchParams.set("google", resultado);
  return new Response(null, { status: 302, headers: { Location: url.toString(), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

Deno.serve(async (req) => {
  try {
    return await atender(req);
  } catch (e) {
    const msg = (e as Error).message ?? "";
    console.error("jarvis-google:", msg);
    if (req.method === "GET") {
      try { return volverALaApp("error"); } catch { /* sin APP_URL */ }
    }
    const configuracion = msg.startsWith("Falta configurar");
    return new Response(JSON.stringify({ error: configuracion ? "configuracion_incompleta" : "error_interno" }), {
      status: configuracion ? 503 : 500, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
});

async function atender(req: Request): Promise<Response> {
  // ---------------- Vuelta desde Google ----------------
  if (req.method === "GET") {
    const p = new URL(req.url).searchParams;
    if (p.get("error")) return volverALaApp("cancelado");
    const codigo = p.get("code"), estado = p.get("state");
    if (!codigo || !estado || estado.length > 200) return new Response("Pedido inválido", { status: 400 });

    // El "state" es de un solo uso: se borra al leerlo
    const { data } = await admin().from("oauth_estados").delete()
      .eq("estado_hash", await sha256Hex(estado)).gt("vence", new Date().toISOString()).select("user_id, verificador");
    if (!data?.length) return new Response("El enlace venció o ya se usó. Vuelva a conectar desde Ajustes.", { status: 400 });
    const { user_id: userId, verificador } = data[0];

    try {
      const refresh = await canjearCodigo(codigo, verificador);
      const { error } = await admin().rpc("guardar_token_google", { p_user: userId, p_token: refresh });
      if (error) throw new Error("guardar_token_google: " + error.message);
      await admin().from("ajustes").upsert({ user_id: userId, google_conectado: true }, { onConflict: "user_id" });
      await admin().from("config_privada").update({ ultima_sync: null }).eq("id", 1); // sincronizar enseguida
      await registrarActividad(userId, { tipo: "vinculo", herramienta: "google_calendar", canal: "web" });
      return volverALaApp("ok");
    } catch (e) {
      await registrarActividad(userId, { tipo: "vinculo", herramienta: "google_calendar", canal: "web", ok: false, resultado: { error: (e as Error).message } });
      return volverALaApp("error");
    }
  }

  // ---------------- Pedidos de la app ----------------
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

  let accion = "";
  try { accion = (JSON.parse(await req.text()) as { accion?: string }).accion ?? ""; } catch { /* inválido */ }

  if (accion === "iniciar") {
    const clientId = requerida("GOOGLE_CLIENT_ID");
    requerida("GOOGLE_CLIENT_SECRET");
    requerida("APP_URL");
    const estado = aleatorio(32);
    const { verificador, desafio } = await pkce();
    await admin().from("oauth_estados").delete().eq("user_id", userId); // un intento a la vez
    const { error } = await admin().from("oauth_estados").insert({ estado_hash: await sha256Hex(estado), user_id: userId, verificador });
    if (error) throw new Error("oauth_estados: " + error.message);
    return respuestaJson(req, 200, { url: urlAutorizacion({ clientId, redirect: urlRetorno(), estado, desafio }) });
  }

  if (accion === "desconectar") {
    const { data: token } = await admin().rpc("leer_token_google", { p_user: userId });
    if (token) await revocar(token as string);
    await admin().rpc("borrar_token_google", { p_user: userId });
    await admin().from("ajustes").update({ google_conectado: false }).eq("user_id", userId);
    // Los avisos de reuniones que todavía no salieron se cancelan
    await admin().from("recordatorios").update({ estado: "cancelado" }).eq("user_id", userId).eq("origen", "evento").eq("estado", "pendiente");
    await admin().from("eventos_avisos").delete().eq("user_id", userId);
    await registrarActividad(userId, { tipo: "vinculo", herramienta: "google_calendar_desconectado", canal: "web" });
    return respuestaJson(req, 200, { ok: true });
  }

  return respuestaJson(req, 400, { error: "peticion_invalida" });
}

