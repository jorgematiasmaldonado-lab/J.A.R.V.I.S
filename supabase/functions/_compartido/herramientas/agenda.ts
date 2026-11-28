// =====================================================================
// J.A.R.V.I.S. · Herramientas de agenda (Google Calendar)
// Autor: Maldonado Jorge Matias
//
//   listar_eventos  (lectura)
//   crear_evento    (escritura reversible: se crea y se confirma en voz;
//                    los avisos de la reunión se programan solos)
// =====================================================================

import { Calendario } from "../google.ts";
import { ErrorMemoria, motivoProhibido } from "../memoria.ts";
import { programarAvisosEvento } from "../programacion.ts";
import { describirCuando, localAUtc, sumarDias, utcALocal } from "../tiempo.ts";
import type { Contexto, Herramienta } from "./tipos.ts";

const MAX_DIAS = 31;

function exigirGoogle(ctx: Contexto): void {
  if (!ctx.ajustes.google_conectado) {
    throw new ErrorMemoria("Google Calendar no está conectado; se conecta en Ajustes → Conexiones");
  }
}

export const listarEventos: Herramienta = {
  nombre: "listar_eventos",
  descripcion: "Lista los eventos del calendario del usuario entre dos fechas (incluidas).",
  nivel: "lectura",
  estado: "REVISANDO AGENDA",
  parametros: {
    type: "object",
    properties: {
      desde: { type: "string", minLength: 10, maxLength: 10, description: "AAAA-MM-DD" },
      hasta: { type: "string", minLength: 10, maxLength: 10, description: "AAAA-MM-DD (por defecto, igual a desde)" },
    },
    required: ["desde"],
  },
  async ejecutar(a, ctx) {
    exigirGoogle(ctx);
    const zona = ctx.ajustes.zona_horaria;
    const desde = localAUtc(a.desde as string, zona);
    const hastaDia = (a.hasta as string) ?? (a.desde as string);
    const hasta = localAUtc(sumarDias(hastaDia, 1), zona);
    if (hasta <= desde) return { error: "El rango de fechas está al revés." };
    if (hasta.getTime() - desde.getTime() > MAX_DIAS * 86400e3) return { error: `Pedí como máximo ${MAX_DIAS} días.` };
    const eventos = await new Calendario(ctx.userId).listar(desde, hasta);
    return {
      eventos: eventos.map((e) => ({
        titulo: e.titulo,
        cuando: e.todoElDia ? `todo el día (${e.inicio})` : describirCuando(new Date(e.inicio), zona),
        termina: e.todoElDia ? null : utcALocal(new Date(e.fin), zona).hora,
        lugar: e.lugar,
      })),
    };
  },
};

export const crearEvento: Herramienta = {
  nombre: "crear_evento",
  descripcion: "Crea un evento (reunión, turno, cita) en Google Calendar y programa sus avisos. Requiere título, día y hora.",
  nivel: "escritura",
  estado: "AGENDANDO",
  parametros: {
    type: "object",
    properties: {
      titulo: { type: "string", minLength: 2, maxLength: 200 },
      inicio: { type: "string", minLength: 16, maxLength: 16, description: "Hora local AAAA-MM-DDTHH:MM." },
      duracion_minutos: { type: "integer", minimum: 5, maximum: 720, description: "Por defecto 60." },
      lugar: { type: "string", maxLength: 200 },
      descripcion: { type: "string", maxLength: 1000 },
    },
    required: ["titulo", "inicio"],
  },
  async ejecutar(a, ctx) {
    exigirGoogle(ctx);
    for (const t of [a.titulo, a.lugar, a.descripcion] as (string | undefined)[]) {
      const m = t ? motivoProhibido(t) : null;
      if (m) throw new ErrorMemoria(`no lo agendo así por seguridad: ${m}`);
    }
    const zona = ctx.ajustes.zona_horaria;
    const inicio = localAUtc(a.inicio as string, zona);
    if (inicio.getTime() < Date.now() - 60e3) return { error: "Esa fecha y hora ya pasaron." };
    const fin = new Date(inicio.getTime() + ((a.duracion_minutos as number) ?? 60) * 60e3);
    const ev = await new Calendario(ctx.userId).crear({
      titulo: (a.titulo as string).trim(), inicio, fin, zona, lugar: a.lugar as string | undefined, descripcion: a.descripcion as string | undefined,
    });
    const avisos = await programarAvisosEvento(
      ctx.userId, { id: ev.id, titulo: ev.titulo, inicio, lugar: ev.lugar },
      { zona, noMolestarDesde: ctx.ajustes.no_molestar_desde, noMolestarHasta: ctx.ajustes.no_molestar_hasta },
    );
    return { creado: true, titulo: ev.titulo, cuando: describirCuando(inicio, zona), lugar: ev.lugar, avisos_programados: avisos };
  },
};
