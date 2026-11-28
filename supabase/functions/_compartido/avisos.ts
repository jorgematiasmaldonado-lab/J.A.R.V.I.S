// =====================================================================
// J.A.R.V.I.S. · Cálculo de avisos e insistencia (lógica pura)
// Autor: Maldonado Jorge Matias
//
// Reuniones: aviso la noche anterior (21:00), 1 hora antes y 15 minutos
// antes. El del resumen matutino lo agrega el propio resumen.
// Insistencia: si no se confirma, se repite cada 5 minutos hasta que se
// confirme o llegue el límite (el inicio del evento). Los recordatorios
// comunes respetan el "no molestar"; los de reuniones, no.
// =====================================================================

import { describirCuando, enNoMolestar, finNoMolestar, localAUtc, sumarDias, utcALocal } from "./tiempo.ts";

export const MINUTOS_INSISTENCIA = 5;
/** Sin límite explícito, un recordatorio común insiste como máximo 2 horas. */
export const HORAS_INSISTENCIA_COMUN = 2;
export const HORA_AVISO_NOCHE = "21:00";

export interface AvisoNuevo {
  tipo_aviso: "noche" | "hora" | "cuarto";
  cuando: Date;
  texto: string;
  insistir: boolean;
  limite: Date;
}

export interface EventoParaAvisos {
  titulo: string;
  inicio: Date;
  lugar?: string | null;
}

export interface Horarios {
  zona: string;
  noMolestarDesde: string; // HH:MM
  noMolestarHasta: string; // HH:MM
}

/** Avisos que corresponden a un evento con hora, solo los que todavía no pasaron. */
export function avisosDeEvento(ev: EventoParaAvisos, h: Horarios, ahora = new Date()): AvisoNuevo[] {
  if (ev.inicio <= ahora) return [];
  const lugar = ev.lugar?.trim() ? ` (en ${ev.lugar.trim()})` : "";
  const avisos: AvisoNuevo[] = [];

  // La noche anterior, a las 21:00 locales; insiste como máximo hasta que empiece el no molestar
  const fechaEvento = utcALocal(ev.inicio, h.zona).fecha;
  const noche = localAUtc(`${sumarDias(fechaEvento, -1)}T${HORA_AVISO_NOCHE}`, h.zona);
  if (noche > ahora) {
    let limiteNoche = localAUtc(`${sumarDias(fechaEvento, -1)}T${h.noMolestarDesde.slice(0, 5)}`, h.zona);
    if (limiteNoche <= noche || limiteNoche > ev.inicio) limiteNoche = new Date(Math.min(noche.getTime() + 2 * 3600e3, ev.inicio.getTime()));
    avisos.push({
      tipo_aviso: "noche",
      cuando: noche,
      texto: `Recordatorio: ${describirCuando(ev.inicio, h.zona, noche)} tiene «${ev.titulo}»${lugar}.`,
      insistir: true,
      limite: limiteNoche,
    });
  }

  for (const [tipo, minutos, frase] of [["hora", 60, "En una hora"], ["cuarto", 15, "En 15 minutos"]] as const) {
    const cuando = new Date(ev.inicio.getTime() - minutos * 60e3);
    if (cuando > ahora) {
      avisos.push({ tipo_aviso: tipo, cuando, texto: `${frase}: «${ev.titulo}»${lugar}.`, insistir: true, limite: ev.inicio });
    }
  }
  return avisos;
}

/** Límite de insistencia por defecto para un recordatorio común. */
export function limiteComun(cuando: Date): Date {
  return new Date(cuando.getTime() + HORAS_INSISTENCIA_COMUN * 3600e3);
}

/**
 * Cuándo volver a avisar después de un aviso, o null si ya no hay que insistir.
 * Los avisos de reuniones (esEvento) ignoran el "no molestar".
 */
export function siguienteAviso(
  op: { ahora: Date; insistir: boolean; limite: Date | null; esEvento: boolean },
  h: Horarios,
): Date | null {
  if (!op.insistir) return null;
  let proximo = new Date(op.ahora.getTime() + MINUTOS_INSISTENCIA * 60e3);
  if (!op.esEvento && enNoMolestar(proximo, h.zona, h.noMolestarDesde, h.noMolestarHasta)) {
    proximo = finNoMolestar(proximo, h.zona, h.noMolestarHasta);
  }
  if (op.limite && proximo >= op.limite) return null;
  return proximo;
}

/**
 * Primer aviso de un recordatorio común: si cae en "no molestar", se corre
 * al final de ese horario (nunca se pierde, solo se demora).
 */
export function primerAviso(cuando: Date, esEvento: boolean, h: Horarios): Date {
  if (esEvento || !enNoMolestar(cuando, h.zona, h.noMolestarDesde, h.noMolestarHasta)) return cuando;
  return finNoMolestar(cuando, h.zona, h.noMolestarHasta);
}
