// =====================================================================
// J.A.R.V.I.S. · Cliente de Supabase
// Autor: Maldonado Jorge Matias
//
// supabase-js se carga por CDN con versión fija y SRI (ver index.html)
// y deja el objeto global `supabase`.
// =====================================================================

import { CONFIGURADO, SUPABASE_CLAVE_PUBLICA, SUPABASE_URL } from "./config.js";

export const sb = CONFIGURADO
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_CLAVE_PUBLICA, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Se entra con código, no con enlace: no se aceptan tokens que vengan en la URL
      detectSessionInUrl: false,
      storageKey: "jarvis_sesion",
    },
  })
  : null;

/** ID del usuario con sesión, o null. */
export async function usuarioId() {
  const { data } = await sb.auth.getSession();
  return data.session?.user?.id ?? null;
}
