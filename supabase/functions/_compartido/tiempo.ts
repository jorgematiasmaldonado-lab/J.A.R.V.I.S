// =====================================================================
// J.A.R.V.I.S. · Fechas y horas en la zona del usuario
// Autor: Maldonado Jorge Matias
//
// El servidor trabaja en UTC; el usuario, en su zona (por defecto
// America/Argentina/Cordoba). Estas funciones convierten sin librerías,
// usando Intl (funciona también para zonas con horario de verano).
// =====================================================================

export interface PartesLocales {
  fecha: string; // YYYY-MM-DD
  hora: string; // HH:MM
  iso: string; // YYYY-MM-DDTHH:MM
}

function partes(d: Date, zona: string): Record<string, string> {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  return Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value]));
}

/** Diferencia (en minutos) entre la hora local de `zona` y UTC en ese instante. */
export function offsetMinutos(d: Date, zona: string): number {
  const p = partes(d, zona);
  const comoUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((comoUtc - Math.floor(d.getTime() / 1000) * 1000) / 60000);
}

export function utcALocal(d: Date, zona: string): PartesLocales {
  const p = partes(d, zona);
  const fecha = `${p.year}-${p.month}-${p.day}`;
  const hora = `${p.hour}:${p.minute}`;
  return { fecha, hora, iso: `${fecha}T${hora}` };
}

const FORMATO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2})?)?$/;

/** "2026-12-04T09:00" (hora local de `zona`) → instante UTC. Lanza si el formato es inválido. */
export function localAUtc(texto: string, zona: string): Date {
  const m = texto.trim().match(FORMATO);
  if (!m) throw new Error(`fecha u hora inválida: "${texto}" (use AAAA-MM-DD o AAAA-MM-DDTHH:MM)`);
  const [, a, me, di, h = "00", mi = "00"] = m;
  if (+me < 1 || +me > 12 || +di < 1 || +di > 31 || +h > 23 || +mi > 59) throw new Error(`fecha u hora inválida: "${texto}"`);
  const ingenuo = Date.UTC(+a, +me - 1, +di, +h, +mi);
  // Dos pasadas para acertar en los cambios de horario
  let utc = ingenuo - offsetMinutos(new Date(ingenuo), zona) * 60000;
  utc = ingenuo - offsetMinutos(new Date(utc), zona) * 60000;
  const d = new Date(utc);
  if (utcALocal(d, zona).fecha !== `${a}-${me}-${di}`) throw new Error(`fecha inexistente: "${texto}"`);
  return d;
}

export function hoyLocal(zona: string, ahora = new Date()): string {
  return utcALocal(ahora, zona).fecha;
}

export function sumarDias(fecha: string, dias: number): string {
  const [a, m, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

function minutosDelDia(hhmm: string): number {
  const [h, m] = hhmm.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
}

/** ¿El instante cae dentro del horario de no molestar? (soporta rangos que cruzan la medianoche) */
export function enNoMolestar(d: Date, zona: string, desde: string, hasta: string): boolean {
  const ahora = minutosDelDia(utcALocal(d, zona).hora);
  const ini = minutosDelDia(desde), fin = minutosDelDia(hasta);
  if (ini === fin) return false;
  return ini < fin ? ahora >= ini && ahora < fin : ahora >= ini || ahora < fin;
}

/** Próximo instante en que termina el no molestar, a partir de `d`. */
export function finNoMolestar(d: Date, zona: string, hasta: string): Date {
  const { fecha } = utcALocal(d, zona);
  let fin = localAUtc(`${fecha}T${hasta.slice(0, 5)}`, zona);
  if (fin <= d) fin = localAUtc(`${sumarDias(fecha, 1)}T${hasta.slice(0, 5)}`, zona);
  return fin;
}

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** "hoy a las 9:00", "mañana a las 18:30" o "el jueves 4 de diciembre a las 9:00". */
export function describirCuando(d: Date, zona: string, ahora = new Date()): string {
  const l = utcALocal(d, zona);
  const hoy = hoyLocal(zona, ahora);
  const [h, m] = l.hora.split(":");
  const hora = `${Number(h)}:${m}`;
  if (l.fecha === hoy) return `hoy a las ${hora}`;
  if (l.fecha === sumarDias(hoy, 1)) return `mañana a las ${hora}`;
  const [a, me, di] = l.fecha.split("-").map(Number);
  const dia = DIAS[new Date(Date.UTC(a, me - 1, di)).getUTCDay()];
  return `el ${dia} ${di} de ${MESES[me - 1]} a las ${hora}`;
}
