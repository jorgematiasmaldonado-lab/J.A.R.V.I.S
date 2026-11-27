// =====================================================================
// J.A.R.V.I.S. · Tipos del adaptador de modelos de lenguaje
// Autor: Maldonado Jorge Matias
//
// Jarvis habla con el modelo SOLO a través de esta interfaz. Para
// cambiar de proveedor (otro modelo de Gemini, la capa paga, Claude…)
// se agrega un adaptador nuevo que la implemente; el resto no cambia.
// El formato de mensajes interno es el de Gemini (role + parts), y cada
// adaptador lo traduce al formato de su proveedor.
// =====================================================================

import type { Esquema } from "../validar.ts";

export interface Parte {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { name: string; args?: Record<string, unknown>; id?: string };
  functionResponse?: { name: string; response: Record<string, unknown>; id?: string };
}

export interface Contenido {
  role: "user" | "model";
  parts: Parte[];
}

export interface DeclaracionHerramienta {
  name: string;
  description: string;
  parameters: Esquema;
}

export interface OpcionesGenerar {
  sistema: string;
  contenidos: Contenido[];
  herramientas?: DeclaracionHerramienta[];
  temperatura?: number;
  maxTokens?: number;
  /** Se llama con cada pedacito de texto a medida que llega (streaming). */
  onTexto?: (delta: string) => void;
}

export interface ResultadoGenerar {
  /** Partes tal como las devolvió el modelo (hay que reenviarlas igual en el historial). */
  partes: Parte[];
  /** Texto visible (sin "pensamientos"). */
  texto: string;
  llamadas: { nombre: string; args: Record<string, unknown>; id?: string }[];
  motivoFin?: string;
}

export interface ProveedorLLM {
  nombre: string;
  modelo: string;
  generar(op: OpcionesGenerar): Promise<ResultadoGenerar>;
}

export class ErrorLLM extends Error {
  constructor(mensaje: string, public estado?: number) { super(mensaje); }
}
