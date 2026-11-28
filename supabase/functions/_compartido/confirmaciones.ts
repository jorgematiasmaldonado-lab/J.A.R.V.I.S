// =====================================================================
// J.A.R.V.I.S. · Confirmación de acciones sensibles
// Autor: Maldonado Jorge Matias
//
// Una acción sensible (borrar, enviar mensajes, gastar créditos) NUNCA
// la ejecuta el modelo. El modelo solo PROPONE: se guarda en
// `acciones_pendientes` exactamente qué se va a hacer, y la app muestra
// una tarjeta Confirmar / Cancelar. Solo el dueño, con su sesión aal2,
// puede confirmarla (Edge Function jarvis-acciones). Así, ni una página
// web ni un archivo ni un mensaje pueden disparar la acción.
// =====================================================================

import { admin, registrarActividad } from "./seguridad.ts";
import { borrarMemorias } from "./memoria.ts";

export interface Propuesta {
  tipo: string;
  resumen: string;
  detalle: string[];
  datos: Record<string, unknown>;
}

export interface AccionPendiente {
  id: string;
  tipo: string;
  resumen: string;
  detalle: string[];
  vence: string;
}

type Ejecutor = (datos: Record<string, unknown>, userId: string) => Promise<Record<string, unknown>>;

/** Lo que hace cada tipo de acción al confirmarse. Agregar acá las nuevas. */
const EJECUTORES: Record<string, Ejecutor> = {
  olvidar_memorias: async (datos, userId) => {
    const ids = (Array.isArray(datos.ids) ? datos.ids : []).filter((x): x is number => Number.isInteger(x)).slice(0, 20);
    return { borrados: await borrarMemorias(userId, ids) };
  },
};

export async function proponer(userId: string, p: Propuesta, canal: string): Promise<AccionPendiente> {
  if (!EJECUTORES[p.tipo]) throw new Error(`tipo de acción desconocido: ${p.tipo}`);
  const { data, error } = await admin().from("acciones_pendientes")
    .insert({ user_id: userId, tipo: p.tipo, resumen: p.resumen.slice(0, 300), detalle: p.detalle.slice(0, 20), datos: p.datos, canal })
    .select("id, tipo, resumen, detalle, vence").single();
  if (error) throw new Error("no pude registrar la acción pendiente: " + error.message);
  await registrarActividad(userId, { tipo: "propuesta", herramienta: p.tipo, canal, parametros: { resumen: p.resumen } });
  return data as AccionPendiente;
}

export class ErrorConfirmacion extends Error {}

/** Confirma o cancela. Atómico: una acción no puede ejecutarse dos veces. */
export async function resolver(
  userId: string, id: string, confirmar: boolean, canal: string,
): Promise<{ estado: string; resultado?: Record<string, unknown> }> {
  const { data: fila } = await admin().from("acciones_pendientes")
    .select("id, tipo, datos, estado, vence").eq("id", id).eq("user_id", userId).maybeSingle();
  if (!fila) throw new ErrorConfirmacion("esa acción no existe");
  if (fila.estado !== "pendiente") throw new ErrorConfirmacion(`esa acción ya estaba ${fila.estado}`);

  const ahora = new Date().toISOString();
  if (new Date(fila.vence) < new Date()) {
    await admin().from("acciones_pendientes").update({ estado: "vencida", resuelto: ahora }).eq("id", id).eq("estado", "pendiente");
    throw new ErrorConfirmacion("la acción venció; pídamela de nuevo");
  }

  // Se "toma" la acción cambiando el estado solo si sigue pendiente
  const nuevo = confirmar ? "confirmada" : "cancelada";
  const { data: tomada } = await admin().from("acciones_pendientes")
    .update({ estado: nuevo, resuelto: ahora }).eq("id", id).eq("user_id", userId).eq("estado", "pendiente").select("id");
  if (!tomada?.length) throw new ErrorConfirmacion("esa acción ya fue resuelta");

  if (!confirmar) {
    await registrarActividad(userId, { tipo: "confirmacion", herramienta: fila.tipo, canal, resultado: { estado: "cancelada" } });
    return { estado: "cancelada" };
  }
  try {
    const resultado = await EJECUTORES[fila.tipo](fila.datos ?? {}, userId);
    await registrarActividad(userId, { tipo: "confirmacion", herramienta: fila.tipo, canal, resultado: { estado: "confirmada", ...resultado } });
    return { estado: "confirmada", resultado };
  } catch (e) {
    await admin().from("acciones_pendientes").update({ estado: "fallida" }).eq("id", id);
    await registrarActividad(userId, { tipo: "confirmacion", herramienta: fila.tipo, canal, ok: false, resultado: { error: (e as Error).message } });
    throw e;
  }
}
