// =====================================================================
// J.A.R.V.I.S. · Inicio de sesión: código por email + TOTP (MFA)
// Autor: Maldonado Jorge Matias
//
// Paso 1: email → Supabase envía un código (no crea usuarios nuevos).
// Paso 2: código del email → sesión de nivel aal1.
// Paso 3: código de la app de autenticación → sesión aal2.
//         La primera vez se da de alta el factor con un QR.
// Sin aal2 ni la base ni la Edge Function entregan datos.
// =====================================================================

import { sb } from "./supa.js";

/** "sin_sesion" | "mfa_alta" | "mfa_verificar" | "lista" */
export async function estadoSesion() {
  const { data: s } = await sb.auth.getSession();
  if (!s.session) return "sin_sesion";
  const { data, error } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) return "sin_sesion";
  if (data.currentLevel === "aal2") return "lista";
  if (data.nextLevel === "aal2") return "mfa_verificar";
  return "mfa_alta";
}

export async function enviarCodigo(email) {
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  // Por seguridad no se distingue "email no autorizado" de "código enviado".
  // Solo se informan los errores que no revelan nada (p. ej. demasiados intentos).
  if (error && error.status === 429) throw new Error("Demasiados intentos. Espere unos minutos.");
}

export async function verificarCodigo(email, codigo) {
  const { error } = await sb.auth.verifyOtp({ email, token: codigo, type: "email" });
  if (error) throw new Error("El código no es válido o venció.");
}

/** Alta del factor TOTP: devuelve el QR y la clave para cargar a mano. */
export async function iniciarAltaMfa() {
  // Si quedó un alta a medias, se elimina para poder empezar de nuevo
  const { data: lista } = await sb.auth.mfa.listFactors();
  for (const f of lista?.all ?? []) {
    if (f.factor_type === "totp" && f.status !== "verified") await sb.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data, error } = await sb.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "Jarvis " + new Date().toISOString().slice(0, 10),
  });
  if (error) throw new Error("No pude iniciar la verificación en dos pasos: " + error.message);
  // Supabase entrega el QR como SVG, a veces dentro de un data: URL sin codificar
  // (que algunos navegadores rechazan). Se normaliza siempre a un data: URL codificado.
  let qr = data.totp.qr_code;
  while (qr.startsWith("data:")) qr = qr.slice(qr.indexOf(",") + 1);
  if (qr.trimStart().startsWith("<")) qr = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(qr);
  else qr = "data:image/svg+xml;charset=utf-8," + qr; // ya venía codificado
  return { factorId: data.id, qr, secreto: data.totp.secret };
}

export async function confirmarAltaMfa(factorId, codigo) {
  const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code: codigo });
  if (error) throw new Error("El código de la app no coincide. Revise la hora del teléfono e intente de nuevo.");
}

export async function verificarMfa(codigo) {
  const { data, error } = await sb.auth.mfa.listFactors();
  if (error) throw new Error("No pude leer sus factores de seguridad.");
  const factor = data.totp?.[0];
  if (!factor) throw new Error("No hay un factor TOTP registrado.");
  const { error: e2 } = await sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code: codigo });
  if (e2) throw new Error("El código de la app no es válido.");
}

/** global = true cierra la sesión en TODOS los dispositivos. */
export async function cerrarSesion(global = false) {
  await sb.auth.signOut({ scope: global ? "global" : "local" });
}
