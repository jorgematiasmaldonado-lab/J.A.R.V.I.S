// =====================================================================
// J.A.R.V.I.S. · Herramienta: clima (Open-Meteo)
// Autor: Maldonado Jorge Matias
//
// Open-Meteo es gratuito para uso no comercial y no necesita clave.
// Ubicación: la del dispositivo (redondeada a ~1 km) o, si no hay, la
// "ciudad base" de Ajustes, que se geocodifica una vez y se guarda.
// =====================================================================

import { admin } from "../seguridad.ts";
import type { Contexto, Herramienta } from "./tipos.ts";

const CODIGOS: Record<number, string> = {
  0: "despejado", 1: "mayormente despejado", 2: "parcialmente nublado", 3: "nublado", 45: "niebla", 48: "niebla con escarcha",
  51: "llovizna leve", 53: "llovizna", 55: "llovizna intensa", 61: "lluvia leve", 63: "lluvia", 65: "lluvia intensa",
  66: "lluvia helada", 67: "lluvia helada intensa", 71: "nevada leve", 73: "nevada", 75: "nevada intensa",
  80: "chaparrones leves", 81: "chaparrones", 82: "chaparrones fuertes", 95: "tormenta", 96: "tormenta con granizo",
  99: "tormenta fuerte con granizo",
};

const redondear = (n: number) => Math.round(n * 100) / 100; // ~1 km

interface RespuestaOpenMeteo {
  results?: { latitude: number; longitude: number }[];
  current: { temperature_2m: number; apparent_temperature: number; weather_code: number; wind_speed_10m: number };
  daily: {
    time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[];
    precipitation_probability_max: number[]; wind_speed_10m_max: number[];
  };
}

async function obtenerJson(url: string): Promise<RespuestaOpenMeteo> {
  const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`el servicio del clima respondió ${r.status}`);
  return await r.json();
}

/** Decide qué coordenadas usar y cómo nombrar el lugar. */
async function resolverUbicacion(ctx: Contexto): Promise<{ lat: number; lon: number; lugar: string }> {
  if (ctx.ubicacion) {
    return { lat: redondear(ctx.ubicacion.lat), lon: redondear(ctx.ubicacion.lon), lugar: "su ubicación actual" };
  }
  const a = ctx.ajustes;
  if (a.ciudad_base && a.ciudad_lat != null && a.ciudad_lon != null) {
    return { lat: a.ciudad_lat, lon: a.ciudad_lon, lugar: a.ciudad_base };
  }
  if (a.ciudad_base) {
    const q = encodeURIComponent(a.ciudad_base);
    const g = await obtenerJson(`https://geocoding-api.open-meteo.com/v1/search?name=${q}&count=1&language=es&format=json`);
    const r = g.results?.[0];
    if (!r) throw new Error(`no encontré la ciudad base "${a.ciudad_base}"; corríjala en Ajustes`);
    const lat = redondear(r.latitude), lon = redondear(r.longitude);
    // Se guarda para no volver a buscarla
    await admin().from("ajustes").update({ ciudad_lat: lat, ciudad_lon: lon }).eq("user_id", ctx.userId);
    a.ciudad_lat = lat; a.ciudad_lon = lon;
    return { lat, lon, lugar: a.ciudad_base };
  }
  throw new Error("no tengo ubicación: active la ubicación del dispositivo o cargue una ciudad base en Ajustes");
}

export const clima: Herramienta = {
  nombre: "obtener_clima",
  descripcion: "Obtiene el clima actual y el pronóstico diario en la ubicación del usuario.",
  nivel: "lectura",
  estado: "CONSULTANDO SENSORES",
  parametros: {
    type: "object",
    properties: {
      dias_adelante: { type: "integer", minimum: 0, maximum: 6, description: "0 = hoy, 1 = mañana, 2 = pasado mañana, hasta 6." },
    },
    required: ["dias_adelante"],
  },

  async ejecutar(args: Record<string, unknown>, ctx: Contexto) {
    const d = (args.dias_adelante as number) ?? 0;
    const u = await resolverUbicacion(ctx);
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${u.lat}&longitude=${u.lon}` +
      `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max` +
      `&timezone=auto&forecast_days=7`;
    const r = await obtenerJson(url);

    const res: Record<string, unknown> = {
      lugar: u.lugar,
      pronostico: {
        fecha: r.daily.time[d],
        estado: CODIGOS[r.daily.weather_code[d]] ?? "variable",
        maxima_c: r.daily.temperature_2m_max[d],
        minima_c: r.daily.temperature_2m_min[d],
        prob_lluvia_pct: r.daily.precipitation_probability_max[d],
        viento_max_kmh: r.daily.wind_speed_10m_max[d],
      },
    };
    if (d === 0) {
      res.ahora = {
        temperatura_c: r.current.temperature_2m,
        sensacion_c: r.current.apparent_temperature,
        estado: CODIGOS[r.current.weather_code] ?? "variable",
        viento_kmh: r.current.wind_speed_10m,
      };
    }
    return res;
  },
};
