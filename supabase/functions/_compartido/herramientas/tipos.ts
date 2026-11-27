// =====================================================================
// J.A.R.V.I.S. · Contrato de las herramientas
// Autor: Maldonado Jorge Matias
//
// Cada herramienta es un módulo con:
//   - declaración (nombre, descripción, esquema de parámetros)
//   - nivel de permiso: lectura | escritura | sensible
//   - ejecutar(args validados, contexto)
// =====================================================================

import type { Esquema } from "../validar.ts";

export type Nivel = "lectura" | "escritura" | "sensible";

export interface Ajustes {
  nombre_trato: string;
  ciudad_base: string | null;
  ciudad_lat: number | null;
  ciudad_lon: number | null;
  zona_horaria: string;
}

export interface Contexto {
  userId: string;
  canal: string;
  ajustes: Ajustes;
  /** Ubicación del dispositivo, ya redondeada (~1 km), si el usuario la habilitó. */
  ubicacion?: { lat: number; lon: number };
}

export interface Herramienta {
  nombre: string;
  descripcion: string;
  nivel: Nivel;
  parametros: Esquema;
  /** Texto del estado del reactor mientras se ejecuta. */
  estado: string;
  ejecutar(args: Record<string, unknown>, ctx: Contexto): Promise<Record<string, unknown>>;
}
