// =====================================================================
// J.A.R.V.I.S. · Seguridad de las Edge Functions
// Autor: Maldonado Jorge Matias
//
// - CORS restringido a los orígenes de ALLOWED_ORIGINS.
// - Verificación del JWT contra Supabase Auth.
// - Solo el email de ALLOWED_EMAIL, con MFA completo (aal2) y
//   registrado en la tabla `dueno`.
// - Límite de peticiones por minuto y por día.
// =====================================================================

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";

// ---------------------------------------------------------------------
// Configuración (secrets de Supabase: Edge Functions → Secrets)
// ---------------------------------------------------------------------
function requerida(nombre: string): string {
  const v = Deno.env.get(nombre);
  if (!v) throw new Error(`Falta configurar el secret ${nombre}`);
  return v;
}

export const config = {
  get supabaseUrl() { return requerida("SUPABASE_URL"); },
  get serviceRoleKey() { return requerida("SUPABASE_SERVICE_ROLE_KEY"); },
  get emailPermitido() { return requerida("ALLOWED_EMAIL").trim().toLowerCase(); },
  get origenes() {
    return requerida("ALLOWED_ORIGINS").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
  },
  limiteMinuto: Number(Deno.env.get("LIMITE_POR_MINUTO") ?? 10),
  limiteDia: Number(Deno.env.get("LIMITE_POR_DIA") ?? 300),
  limiteLlmDia: Number(Deno.env.get("LIMITE_LLM_POR_DIA") ?? 800),
};

let _admin: SupabaseClient | null = null;
/** Cliente con service role: SOLO se usa dentro del servidor. */
export function admin(): SupabaseClient {
  if (!_admin) {
    _admin = createClient(config.supabaseUrl, config.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _admin;
}

// ---------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------
export function encabezadosCors(req: Request): Record<string, string> {
  const origen = (req.headers.get("Origin") ?? "").replace(/\/$/, "");
  const permitido = config.origenes.includes(origen);
  return {
    ...(permitido ? { "Access-Control-Allow-Origin": origen } : {}),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

export function origenPermitido(req: Request): boolean {
  const origen = (req.headers.get("Origin") ?? "").replace(/\/$/, "");
  return config.origenes.includes(origen);
}

export function respuestaJson(req: Request, estado: number, cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: {
      ...encabezadosCors(req),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

// ---------------------------------------------------------------------
// Autenticación
// ---------------------------------------------------------------------
export interface Usuario {
  id: string;
  email: string;
}

export class ErrorAcceso extends Error {
  constructor(public estado: number, public codigo: string, mensaje: string) { super(mensaje); }
}

function payloadJwt(token: string): Record<string, unknown> {
  const parte = token.split(".")[1] ?? "";
  const b64 = parte.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(parte.length / 4) * 4, "=");
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));
}

/** Verifica el JWT, el email, el MFA y que sea el dueño. Registra los intentos fallidos. */
export async function verificarUsuario(req: Request, canal: string): Promise<Usuario> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || token.split(".").length !== 3) throw new ErrorAcceso(401, "sin_sesion", "Falta iniciar sesión");

  // 1) Firma y vigencia: lo comprueba el servidor de Auth
  const { data, error } = await admin().auth.getUser(token);
  if (error || !data?.user) throw new ErrorAcceso(401, "sesion_invalida", "La sesión no es válida o venció");
  const user = data.user;

  // 2) Email permitido (el token ya fue validado por Auth, así que leer sus claims es seguro)
  const email = (user.email ?? "").toLowerCase();
  if (email !== config.emailPermitido) {
    await registrarActividad(null, { tipo: "acceso_denegado", ok: false, canal, parametros: { motivo: "email_no_permitido" } });
    throw new ErrorAcceso(403, "no_permitido", "Acceso denegado");
  }

  // 3) MFA completo
  const claims = payloadJwt(token);
  if (claims.aal !== "aal2") throw new ErrorAcceso(403, "mfa_requerido", "Falta completar la verificación en dos pasos");

  // 4) Registrado como dueño
  const { data: dueno } = await admin().from("dueno").select("user_id").eq("user_id", user.id).maybeSingle();
  if (!dueno) {
    await registrarActividad(user.id, { tipo: "acceso_denegado", ok: false, canal, parametros: { motivo: "no_es_dueno" } });
    throw new ErrorAcceso(403, "no_es_dueno", "Falta registrar el dueño en la base (README, paso 4)");
  }

  return { id: user.id, email };
}

// ---------------------------------------------------------------------
// Límites de uso
// ---------------------------------------------------------------------
export async function consumirCupo(
  userId: string, tipo: "peticion" | "llm", maxMinuto: number, maxDia: number, zona: string, cantidad = 1,
): Promise<{ permitido: boolean; minuto: number; dia: number }> {
  const { data, error } = await admin().rpc("consumir_cupo", {
    p_user: userId, p_tipo: tipo, p_max_minuto: maxMinuto, p_max_dia: maxDia, p_zona: zona, p_cantidad: cantidad,
  });
  if (error) throw new Error("No pude verificar el límite de uso: " + error.message);
  return data;
}

// ---------------------------------------------------------------------
// Auditoría
// ---------------------------------------------------------------------
export async function registrarActividad(
  userId: string | null,
  fila: { tipo: string; herramienta?: string; parametros?: unknown; resultado?: unknown; ok?: boolean; canal?: string },
): Promise<void> {
  // La auditoría nunca debe tumbar la respuesta: si falla, se informa en los logs
  const { error } = await admin().from("actividad").insert({ user_id: userId, ok: true, ...fila });
  if (error) console.error("No se pudo registrar actividad:", error.message);
}
