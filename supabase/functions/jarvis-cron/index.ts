// =====================================================================
// J.A.R.V.I.S. · Edge Function "jarvis-cron" (el reloj)
// Autor: Maldonado Jorge Matias
//
// La llama pg_cron (función tick_jarvis) SOLO cuando hay algo para hacer:
//   1. Sincronizar el calendario (cada 15 min) y programar avisos.
//   2. Enviar recordatorios vencidos e insistir.
//   3. Enviar el resumen matutino.
// Autenticación: encabezado x-jarvis-reloj con un secreto generado dentro
// de la base (config_privada). No acepta llamadas de navegadores.
// =====================================================================

import type { Horarios } from "../_compartido/avisos.ts";
import { AJUSTES_POR_DEFECTO, type Ajustes, COLUMNAS_AJUSTES } from "../_compartido/herramientas/tipos.ts";
import { sincronizarCalendario } from "../_compartido/programacion.ts";
import { procesarRecordatorios } from "../_compartido/reloj.ts";
import { generarResumen } from "../_compartido/resumen.ts";
import { admin, registrarActividad } from "../_compartido/seguridad.ts";
import { compararSeguro } from "../_compartido/telegram.ts";
import { hoyLocal, utcALocal } from "../_compartido/tiempo.ts";

const SYNC_CADA_MINUTOS = 14;

function json(estado: number, cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

Deno.serve(async (req) => {
  try {
    return await atender(req);
  } catch (e) {
    console.error("jarvis-cron:", (e as Error).message);
    return json(500, { error: "error_interno" });
  }
});

async function atender(req: Request): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "metodo_no_permitido" });
  const db = admin();
  const { data: c } = await db.from("config_privada").select("secreto_reloj, ultima_sync").eq("id", 1).maybeSingle();
  if (!c || !compararSeguro(req.headers.get("x-jarvis-reloj") ?? "", c.secreto_reloj)) return json(401, { error: "no_autorizado" });

  const { data: dueno } = await db.from("dueno").select("user_id").limit(1).maybeSingle();
  if (!dueno) return json(200, { nada: "sin dueño" });
  const userId = dueno.user_id as string;

  const { data: aj } = await db.from("ajustes")
    .select(`${COLUMNAS_AJUSTES}, resumen_activo, resumen_hora, ultimo_resumen, avisar_eventos`).eq("user_id", userId).maybeSingle();
  const ajustes = { ...AJUSTES_POR_DEFECTO, ...(aj ?? {}) } as Ajustes & {
    resumen_activo: boolean; resumen_hora: string; ultimo_resumen: string | null; avisar_eventos: boolean;
  };
  const h: Horarios = { zona: ajustes.zona_horaria, noMolestarDesde: ajustes.no_molestar_desde, noMolestarHasta: ajustes.no_molestar_hasta };
  const ahora = new Date();
  const informe: Record<string, unknown> = {};

  // 1) Calendario
  const syncVieja = !c.ultima_sync || ahora.getTime() - new Date(c.ultima_sync).getTime() > SYNC_CADA_MINUTOS * 60e3;
  if (ajustes.google_conectado && ajustes.avisar_eventos !== false && syncVieja) {
    await db.from("config_privada").update({ ultima_sync: ahora.toISOString() }).eq("id", 1);
    try {
      informe.calendario = await sincronizarCalendario(userId, h, ahora);
    } catch (e) {
      informe.calendario = { error: (e as Error).message };
      await registrarActividad(userId, { tipo: "reloj", herramienta: "sincronizar_calendario", canal: "reloj", ok: false, resultado: { error: (e as Error).message } });
    }
  }

  // 2) Recordatorios
  informe.avisos_enviados = await procesarRecordatorios(userId, ajustes, h, ahora);

  // 3) Resumen matutino (una vez por día, a partir de la hora elegida)
  const hoy = hoyLocal(h.zona, ahora);
  const horaLocal = utcALocal(ahora, h.zona).hora;
  if (
    ajustes.resumen_activo && ajustes.telegram_chat_id && horaLocal >= ajustes.resumen_hora.slice(0, 5) &&
    (!ajustes.ultimo_resumen || ajustes.ultimo_resumen < hoy)
  ) {
    // Se marca antes de generar, para que nunca salga dos veces
    // (condición sobre el valor recién leído: si otra ejecución ya lo marcó, no coincide)
    let q = db.from("ajustes").update({ ultimo_resumen: hoy }).eq("user_id", userId);
    q = ajustes.ultimo_resumen ? q.eq("ultimo_resumen", ajustes.ultimo_resumen) : q.is("ultimo_resumen", null);
    const { data: tomado } = await q.select("user_id");
    if (tomado?.length) {
      try {
        await generarResumen(userId, ajustes, { enviarTelegram: true });
        informe.resumen = "enviado";
      } catch (e) {
        informe.resumen = { error: (e as Error).message };
        await registrarActividad(userId, { tipo: "resumen", canal: "reloj", ok: false, resultado: { error: (e as Error).message } });
      }
    }
  }
  return json(200, informe);
}
