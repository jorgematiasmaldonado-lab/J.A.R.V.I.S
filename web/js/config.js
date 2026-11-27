// =====================================================================
// J.A.R.V.I.S. · Configuración pública del frontend
// Autor: Maldonado Jorge Matias
//
// Estos valores NO son secretos: la URL del proyecto y la clave
// publicable (o "anon") de Supabase están pensadas para ir en el
// navegador. Lo que protege los datos es la RLS y la verificación de la
// Edge Function.
//
// NO se completan a mano: el workflow de GitHub Pages reemplaza los
// marcadores con las Variables del repositorio (README, paso 6), y se
// niega a publicar si detecta una clave secreta.
// =====================================================================

export const SUPABASE_URL = "__SUPABASE_URL__";
export const SUPABASE_CLAVE_PUBLICA = "__SUPABASE_CLAVE_PUBLICA__";
export const VERSION = "__VERSION__";

/** ¿Está configurado? (falso mientras queden los marcadores) */
export const CONFIGURADO = !SUPABASE_URL.startsWith("__") && !SUPABASE_CLAVE_PUBLICA.startsWith("__");
