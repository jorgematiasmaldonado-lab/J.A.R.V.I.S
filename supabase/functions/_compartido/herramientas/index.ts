// =====================================================================
// J.A.R.V.I.S. · Registro de herramientas y ejecución controlada
// Autor: Maldonado Jorge Matias
//
// Agregar una herramienta = crear su módulo y sumarla a REGISTRO.
// Toda ejecución pasa por acá: valida parámetros, aplica el nivel de
// permiso y deja el registro en `actividad`.
//   lectura / escritura → se ejecutan
//   sensible            → solo se PROPONEN: tarjeta Confirmar / Cancelar
// =====================================================================

import { proponer } from "../confirmaciones.ts";
import { ErrorLLM } from "../llm/tipos.ts";
import { ErrorMemoria } from "../memoria.ts";
import { registrarActividad } from "../seguridad.ts";
import { ErrorValidacion, validar } from "../validar.ts";
import type { DeclaracionHerramienta } from "../llm/tipos.ts";
import { clima } from "./clima.ts";
import { buscarRecuerdos, guardarRecuerdo, olvidarRecuerdo } from "./memoria.ts";
import type { Contexto, Herramienta } from "./tipos.ts";

const REGISTRO: Herramienta[] = [clima, guardarRecuerdo, buscarRecuerdos, olvidarRecuerdo];
const POR_NOMBRE = new Map(REGISTRO.map((h) => [h.nombre, h]));

export function declaraciones(): DeclaracionHerramienta[] {
  return REGISTRO.map((h) => ({ name: h.nombre, description: h.descripcion, parameters: h.parametros }));
}

export function estadoDe(nombre: string): string {
  return POR_NOMBRE.get(nombre)?.estado ?? "PROCESANDO";
}

/** Mensaje de error apto para mostrar (los errores internos no se detallan). */
function mensajeDeError(e: unknown): string {
  if (e instanceof ErrorMemoria || e instanceof ErrorLLM || e instanceof ErrorValidacion) return e.message;
  const msg = (e as Error)?.message ?? "";
  // Los errores de herramientas propias (p. ej. clima) ya vienen redactados para el usuario
  if (/^(no |el servicio|la ciudad|no tengo)/i.test(msg)) return msg;
  console.error("Error en herramienta:", msg);
  return "tuve un problema interno con esa función";
}

/** Ejecuta una herramienta pedida por el modelo. Nunca lanza: devuelve { error } para que el modelo lo explique. */
export async function ejecutarHerramienta(
  nombre: string, argsCrudos: Record<string, unknown>, ctx: Contexto,
): Promise<Record<string, unknown>> {
  const h = POR_NOMBRE.get(nombre);
  if (!h) return { error: "Herramienta desconocida" };

  let args: Record<string, unknown>;
  try {
    args = validar(argsCrudos, h.parametros) as Record<string, unknown>;
  } catch (e) {
    const msg = e instanceof ErrorValidacion ? e.message : "parámetros inválidos";
    await registrarActividad(ctx.userId, { tipo: "herramienta", herramienta: nombre, ok: false, canal: ctx.canal, resultado: { error: msg } });
    return { error: msg };
  }

  // ---- Sensibles: solo se proponen ------------------------------------
  if (h.nivel === "sensible") {
    if (!h.proponer) return { error: "Esta acción todavía no está habilitada." };
    try {
      const p = await h.proponer(args, ctx);
      if ("nada" in p) return { resultado: p.nada };
      const accion = await proponer(ctx.userId, p, ctx.canal);
      ctx.onConfirmacion?.(accion);
      return {
        estado: "pendiente_de_confirmacion",
        resumen: p.resumen,
        detalle: p.detalle,
        instruccion: "Todavía NO se hizo. El usuario tiene que tocar Confirmar en la tarjeta de la pantalla.",
      };
    } catch (e) {
      const msg = mensajeDeError(e);
      await registrarActividad(ctx.userId, { tipo: "herramienta", herramienta: nombre, ok: false, canal: ctx.canal, resultado: { error: msg } });
      return { error: msg };
    }
  }

  // ---- Lectura y escritura ---------------------------------------------
  if (!h.ejecutar) return { error: "Herramienta mal configurada" };
  try {
    const res = await h.ejecutar(args, ctx);
    await registrarActividad(ctx.userId, {
      tipo: "herramienta", herramienta: nombre, ok: true, canal: ctx.canal,
      // Los parámetros de memoria son datos personales: se registra solo su tamaño
      parametros: nombre.includes("memoria") ? { largo: JSON.stringify(args).length } : args,
      resultado: nombre.includes("memoria") ? { ok: true } : resumir(res),
    });
    return res;
  } catch (e) {
    const msg = mensajeDeError(e);
    await registrarActividad(ctx.userId, { tipo: "herramienta", herramienta: nombre, ok: false, canal: ctx.canal, resultado: { error: msg } });
    return { error: msg };
  }
}

/** Guarda un resultado acotado en la auditoría (máx. ~2 KB). */
function resumir(res: unknown): unknown {
  const s = JSON.stringify(res);
  return s.length <= 2000 ? res : { recortado: s.slice(0, 2000) };
}

export type { Contexto } from "./tipos.ts";
