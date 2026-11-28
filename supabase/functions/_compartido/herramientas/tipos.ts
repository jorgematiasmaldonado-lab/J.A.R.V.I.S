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
import type { Seudonimizador } from "../seudonimizar.ts";
import type { ProveedorEmbeddings } from "../llm/embeddings.ts";
import type { AccionPendiente, Propuesta } from "../confirmaciones.ts";

export type Nivel = "lectura" | "escritura" | "sensible";

export interface Ajustes {
  nombre_trato: string;
  ciudad_base: string | null;
  ciudad_lat: number | null;
  ciudad_lon: number | null;
  zona_horaria: string;
  google_conectado: boolean;
  no_molestar_desde: string;
  no_molestar_hasta: string;
  telegram_chat_id: number | null;
}

export const AJUSTES_POR_DEFECTO: Ajustes = {
  nombre_trato: "señor", ciudad_base: null, ciudad_lat: null, ciudad_lon: null,
  zona_horaria: "America/Argentina/Cordoba", google_conectado: false,
  no_molestar_desde: "23:00", no_molestar_hasta: "07:00", telegram_chat_id: null,
};

export const COLUMNAS_AJUSTES =
  "nombre_trato, ciudad_base, ciudad_lat, ciudad_lon, zona_horaria, google_conectado, no_molestar_desde, no_molestar_hasta, telegram_chat_id";

export interface Contexto {
  userId: string;
  canal: string;
  ajustes: Ajustes;
  /** Ubicación del dispositivo, ya redondeada (~1 km), si el usuario la habilitó. */
  ubicacion?: { lat: number; lon: number };
  seud: Seudonimizador;
  /** null si no hay embeddings configurados (la memoria queda desactivada). */
  emb: ProveedorEmbeddings | null;
  /** Control de cupo antes de cada llamada de embeddings. */
  contarEmb?: () => Promise<void>;
  /** Avisa a la app que hay una acción esperando Confirmar/Cancelar. */
  onConfirmacion?: (a: AccionPendiente) => void;
}

export interface Herramienta {
  nombre: string;
  descripcion: string;
  nivel: Nivel;
  parametros: Esquema;
  /** Texto del estado del reactor mientras se ejecuta. */
  estado: string;
  /** Lectura y escritura: se ejecutan directamente. */
  ejecutar?(args: Record<string, unknown>, ctx: Contexto): Promise<Record<string, unknown>>;
  /**
   * Sensibles: NO se ejecutan. Arman la propuesta exacta que verá el
   * usuario en la tarjeta; null = no hay nada que proponer (con el motivo).
   */
  proponer?(args: Record<string, unknown>, ctx: Contexto): Promise<Propuesta | { nada: string }>;
}
