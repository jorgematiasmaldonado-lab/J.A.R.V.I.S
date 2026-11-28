// =====================================================================
// J.A.R.V.I.S. · Google Calendar (OAuth 2.0 con PKCE)
// Autor: Maldonado Jorge Matias
//
// - Permiso mínimo: https://www.googleapis.com/auth/calendar.events
//   (ver y crear eventos; no da acceso a otros datos de Google).
// - El refresh token vive cifrado en Supabase Vault; acá solo se pide un
//   token de acceso de corta duración cada vez que hace falta.
// - Secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET.
// =====================================================================

import { admin } from "./seguridad.ts";

export const ALCANCE = "https://www.googleapis.com/auth/calendar.events";
const AUTORIZAR = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const REVOCAR = "https://oauth2.googleapis.com/revoke";
const CALENDARIO = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

export class ErrorGoogle extends Error {}

function requerida(nombre: string): string {
  const v = Deno.env.get(nombre);
  if (!v) throw new Error(`Falta configurar el secret ${nombre}`);
  return v;
}

export function urlRetorno(): string {
  return `${requerida("SUPABASE_URL").replace(/\/$/, "")}/functions/v1/jarvis-google`;
}

// ---------------------------------------------------------------------
// Utilidades de seguridad
// ---------------------------------------------------------------------
function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function aleatorio(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256Hex(texto: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto)));
  return [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** PKCE: el verificador queda en el servidor; a Google solo va su hash. */
export async function pkce(): Promise<{ verificador: string; desafio: string }> {
  const verificador = aleatorio(48);
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verificador)));
  return { verificador, desafio: base64url(h) };
}

export function urlAutorizacion(op: { clientId: string; redirect: string; estado: string; desafio: string }): string {
  const p = new URLSearchParams({
    client_id: op.clientId,
    redirect_uri: op.redirect,
    response_type: "code",
    scope: ALCANCE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state: op.estado,
    code_challenge: op.desafio,
    code_challenge_method: "S256",
  });
  return `${AUTORIZAR}?${p}`;
}

// ---------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------
async function pedirToken(cuerpo: Record<string, string>): Promise<Record<string, unknown>> {
  const r = await fetch(TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: requerida("GOOGLE_CLIENT_ID"), client_secret: requerida("GOOGLE_CLIENT_SECRET"), ...cuerpo }),
    signal: AbortSignal.timeout(15_000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new ErrorGoogle(`Google rechazó el pedido de permiso (${(j as { error?: string }).error ?? r.status})`);
    (e as ErrorGoogle & { codigo?: string }).codigo = (j as { error?: string }).error;
    throw e;
  }
  return j;
}

/** Cambia el código de autorización por el refresh token. */
export async function canjearCodigo(codigo: string, verificador: string): Promise<string> {
  const j = await pedirToken({ grant_type: "authorization_code", code: codigo, code_verifier: verificador, redirect_uri: urlRetorno() });
  const refresh = j.refresh_token as string | undefined;
  if (!refresh) throw new ErrorGoogle("Google no entregó un permiso permanente; quite el acceso de Jarvis en su cuenta de Google y vuelva a conectar");
  if (!String(j.scope ?? "").includes(ALCANCE)) throw new ErrorGoogle("no se otorgó el permiso del calendario");
  return refresh;
}

export async function revocar(token: string): Promise<void> {
  await fetch(`${REVOCAR}?token=${encodeURIComponent(token)}`, { method: "POST", signal: AbortSignal.timeout(10_000) }).catch(() => {});
}

// ---------------------------------------------------------------------
// Calendario
// ---------------------------------------------------------------------
export interface Evento {
  id: string;
  titulo: string;
  inicio: string; // ISO con zona, o AAAA-MM-DD si es de todo el día
  fin: string;
  todoElDia: boolean;
  lugar: string | null;
}

interface EventoGoogle {
  id: string;
  status?: string;
  summary?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

function convertir(e: EventoGoogle): Evento {
  return {
    id: e.id,
    titulo: e.summary?.trim() || "(sin título)",
    inicio: e.start?.dateTime ?? e.start?.date ?? "",
    fin: e.end?.dateTime ?? e.end?.date ?? "",
    todoElDia: !e.start?.dateTime,
    lugar: e.location?.trim() || null,
  };
}

export class Calendario {
  private acceso: string | null = null;
  constructor(private userId: string) {}

  private async token(): Promise<string> {
    if (this.acceso) return this.acceso;
    const { data: refresh, error } = await admin().rpc("leer_token_google", { p_user: this.userId });
    if (error) throw new Error("leer_token_google: " + error.message);
    if (!refresh) throw new ErrorGoogle("Google Calendar no está conectado; conéctelo en Ajustes");
    try {
      const j = await pedirToken({ grant_type: "refresh_token", refresh_token: refresh as string });
      this.acceso = j.access_token as string;
      return this.acceso;
    } catch (e) {
      // invalid_grant = el permiso fue revocado o venció: se marca como desconectado
      if ((e as { codigo?: string }).codigo === "invalid_grant") {
        await admin().from("ajustes").update({ google_conectado: false }).eq("user_id", this.userId);
        await admin().rpc("borrar_token_google", { p_user: this.userId });
        throw new ErrorGoogle("perdí el permiso de Google Calendar; vuelva a conectarlo en Ajustes");
      }
      throw e;
    }
  }

  private async pedir(url: string, init: RequestInit = {}): Promise<unknown> {
    const r = await fetch(url, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${await this.token()}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) throw new ErrorGoogle(`Google Calendar respondió ${r.status}`);
    return r.json();
  }

  async listar(desde: Date, hasta: Date): Promise<Evento[]> {
    const p = new URLSearchParams({
      timeMin: desde.toISOString(), timeMax: hasta.toISOString(),
      singleEvents: "true", orderBy: "startTime", maxResults: "50",
    });
    const j = await this.pedir(`${CALENDARIO}?${p}`) as { items?: EventoGoogle[] };
    return (j.items ?? []).filter((e) => e.status !== "cancelled").map(convertir);
  }

  async crear(op: { titulo: string; inicio: Date; fin: Date; zona: string; lugar?: string; descripcion?: string }): Promise<Evento> {
    const cuerpo = {
      summary: op.titulo,
      location: op.lugar || undefined,
      description: op.descripcion || undefined,
      start: { dateTime: op.inicio.toISOString(), timeZone: op.zona },
      end: { dateTime: op.fin.toISOString(), timeZone: op.zona },
    };
    return convertir(await this.pedir(CALENDARIO, { method: "POST", body: JSON.stringify(cuerpo) }) as EventoGoogle);
  }
}

/** ¿Hay calendario conectado? (sin llamar a Google) */
export async function googleConectado(userId: string): Promise<boolean> {
  const { data } = await admin().from("ajustes").select("google_conectado").eq("user_id", userId).maybeSingle();
  return !!data?.google_conectado;
}
