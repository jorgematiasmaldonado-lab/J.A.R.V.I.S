// =====================================================================
// J.A.R.V.I.S. · Envío de recordatorios con insistencia
// Autor: Maldonado Jorge Matias
//
// Cada recordatorio vencido se "toma" con una actualización condicional
// (si otra ejecución ya lo tomó, se saltea) y recién después se envía:
// así nunca llega dos veces el mismo aviso.
// =====================================================================

import { siguienteAviso, type Horarios } from "./avisos.ts";
import type { Ajustes } from "./herramientas/tipos.ts";
import { admin, registrarActividad } from "./seguridad.ts";
import { enviar } from "./telegram.ts";

const POR_VUELTA = 20;

export interface FilaRecordatorio {
  id: number;
  texto: string;
  origen: string;
  insistir: boolean;
  limite: string | null;
  avisos: number;
  estado: string;
  proximo_aviso: string;
}

/** Texto del aviso según cuántas veces se insistió. */
export function textoAviso(r: Pick<FilaRecordatorio, "texto" | "avisos">, nombre: string): string {
  if (r.avisos === 0) return `⏰ ${r.texto}`;
  if (r.avisos < 3) return `⏰ Insisto, ${nombre}: ${r.texto}`;
  return `⏰ ${nombre[0].toUpperCase()}${nombre.slice(1)}, sigo esperando su confirmación: ${r.texto}`;
}

export async function procesarRecordatorios(userId: string, ajustes: Ajustes, h: Horarios, ahora = new Date()): Promise<number> {
  const db = admin();
  const { data, error } = await db.from("recordatorios")
    .select("id, texto, origen, insistir, limite, avisos, estado, proximo_aviso")
    .eq("user_id", userId).in("estado", ["pendiente", "avisado"]).lte("proximo_aviso", ahora.toISOString())
    .order("proximo_aviso").limit(POR_VUELTA);
  if (error) throw new Error("recordatorios: " + error.message);

  let enviados = 0;
  for (const r of (data ?? []) as FilaRecordatorio[]) {
    const limite = r.limite ? new Date(r.limite) : null;
    const vencido = limite !== null && ahora >= limite;
    // Si ya pasó el límite y alguna vez se avisó, no se insiste más
    if (vencido && r.avisos > 0) {
      await db.from("recordatorios").update({ proximo_aviso: null }).eq("id", r.id).eq("proximo_aviso", r.proximo_aviso);
      continue;
    }
    const proximo = vencido ? null : siguienteAviso({ ahora, insistir: r.insistir, limite, esEvento: r.origen === "evento" }, h);

    // Tomar el recordatorio (solo si nadie lo tomó antes)
    const { data: tomado } = await db.from("recordatorios")
      .update({ estado: "avisado", avisos: r.avisos + 1, proximo_aviso: proximo?.toISOString() ?? null })
      .eq("id", r.id).eq("proximo_aviso", r.proximo_aviso).in("estado", ["pendiente", "avisado"]).select("id");
    if (!tomado?.length) continue;

    if (ajustes.telegram_chat_id) {
      try {
        await enviar(ajustes.telegram_chat_id, textoAviso(r, ajustes.nombre_trato), [[{ texto: "✅ Entendido", datos: `ok:${r.id}` }]]);
        enviados++;
      } catch (e) {
        console.error("No se pudo enviar el aviso por Telegram:", (e as Error).message);
      }
    }
    if (r.avisos === 0) {
      await registrarActividad(userId, { tipo: "aviso", herramienta: r.origen === "evento" ? "aviso_reunion" : "recordatorio", canal: "telegram", parametros: { id: r.id } });
    }
  }
  return enviados;
}
