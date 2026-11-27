// =====================================================================
// J.A.R.V.I.S. · Registro de herramientas y ejecución controlada
// Autor: Maldonado Jorge Matias
//
// Agregar una herramienta = crear su módulo y sumarla a REGISTRO.
// Toda ejecución pasa por acá: valida parámetros, aplica el nivel de
// permiso y deja el registro en `actividad`.
// =====================================================================

import { registrarActividad } from "../seguridad.ts";
import { ErrorValidacion, validar } from "../validar.ts";
import type { DeclaracionHerramienta } from "../llm/tipos.ts";
import { clima } from "./clima.ts";
import type { Contexto, Herramienta } from "./tipos.ts";

const REGISTRO: Herramienta[] = [clima];
const POR_NOMBRE = new Map(REGISTRO.map((h) => [h.nombre, h]));

export function declaraciones(): DeclaracionHerramienta[] {
  return REGISTRO.map((h) => ({ name: h.nombre, description: h.descripcion, parameters: h.parametros }));
}

export function estadoDe(nombre: string): string {
  return POR_NOMBRE.get(nombre)?.estado ?? "PROCESANDO";
}

/** Ejecuta una herramienta pedida por el modelo. Nunca lanza: devuelve { error } para que el modelo lo explique. */
export async function ejecutarHerramienta(
  nombre: string, argsCrudos: Record<string, unknown>, ctx: Contexto,
): Promise<Record<string, unknown>> {
  const h = POR_NOMBRE.get(nombre);
  if (!h) return { error: "Herramienta desconocida" };

  // Las acciones sensibles necesitan confirmación explícita del usuario
  // (tarjeta Confirmar/Cancelar + huella en Android). Llega en la Fase 2/4:
  // hasta entonces se bloquean siempre.
  if (h.nivel === "sensible") {
    await registrarActividad(ctx.userId, { tipo: "herramienta", herramienta: nombre, ok: false, canal: ctx.canal, resultado: { bloqueada: "requiere confirmación" } });
    return { error: "Esta acción requiere confirmación del usuario y todavía no está habilitada." };
  }

  let args: Record<string, unknown>;
  try {
    args = validar(argsCrudos, h.parametros) as Record<string, unknown>;
  } catch (e) {
    const msg = e instanceof ErrorValidacion ? e.message : "parámetros inválidos";
    await registrarActividad(ctx.userId, { tipo: "herramienta", herramienta: nombre, ok: false, canal: ctx.canal, resultado: { error: msg } });
    return { error: msg };
  }

  try {
    const res = await h.ejecutar(args, ctx);
    await registrarActividad(ctx.userId, { tipo: "herramienta", herramienta: nombre, parametros: args, ok: true, canal: ctx.canal, resultado: resumir(res) });
    return res;
  } catch (e) {
    const msg = (e as Error).message;
    await registrarActividad(ctx.userId, { tipo: "herramienta", herramienta: nombre, parametros: args, ok: false, canal: ctx.canal, resultado: { error: msg } });
    return { error: msg };
  }
}

/** Guarda un resultado acotado en la auditoría (máx. ~2 KB). */
function resumir(res: unknown): unknown {
  const s = JSON.stringify(res);
  return s.length <= 2000 ? res : { recortado: s.slice(0, 2000) };
}

export type { Contexto } from "./tipos.ts";
