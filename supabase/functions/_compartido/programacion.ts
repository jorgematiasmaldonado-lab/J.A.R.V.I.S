// =====================================================================
// J.A.R.V.I.S. · Programar avisos de reuniones y sincronizar el calendario
// Autor: Maldonado Jorge Matias
// =====================================================================

import { avisosDeEvento, type Horarios } from "./avisos.ts";
import { Calendario, type Evento } from "./google.ts";
import { motivoProhibido } from "./memoria.ts";
import { admin } from "./seguridad.ts";

/** Ventana de sincronización: eventos de las próximas 48 horas. */
const VENTANA_HORAS = 48;

function textoSeguro(t: string): string {
  // Un título con un dato prohibido (p. ej. una clave) no se copia a la base
  return motivoProhibido(t) ? "Evento del calendario" : t.slice(0, 200);
}

/** (Re)programa los avisos de un evento con hora. Devuelve cuántos quedaron. */
export async function programarAvisosEvento(
  userId: string, ev: { id: string; titulo: string; inicio: Date; lugar?: string | null }, h: Horarios, ahora = new Date(),
): Promise<number> {
  const db = admin();
  // Los avisos todavía no enviados se rehacen (por si cambió la hora)
  await db.from("recordatorios").delete().eq("user_id", userId).eq("evento_id", ev.id).eq("estado", "pendiente");
  const titulo = textoSeguro(ev.titulo);
  const lugar = ev.lugar ? textoSeguro(ev.lugar) : null;
  const avisos = avisosDeEvento({ titulo, inicio: ev.inicio, lugar }, h, ahora);
  if (avisos.length) {
    const { error } = await db.from("recordatorios").insert(avisos.map((a) => ({
      user_id: userId, texto: a.texto.slice(0, 300), cuando: a.cuando.toISOString(), origen: "evento", evento_id: ev.id,
      tipo_aviso: a.tipo_aviso, insistir: a.insistir, limite: a.limite.toISOString(), proximo_aviso: a.cuando.toISOString(),
      canal: "calendario",
    })));
    if (error) throw new Error("programar avisos: " + error.message);
  }
  await db.from("eventos_avisos").upsert(
    { user_id: userId, evento_id: ev.id, titulo, inicio: ev.inicio.toISOString(), actualizado: new Date().toISOString() },
    { onConflict: "user_id,evento_id" },
  );
  return avisos.length;
}

/** Trae los eventos con hora de las próximas 48 h y ajusta los avisos. */
export async function sincronizarCalendario(userId: string, h: Horarios, ahora = new Date()): Promise<{ eventos: number; cambios: number }> {
  const db = admin();
  const hasta = new Date(ahora.getTime() + VENTANA_HORAS * 3600e3);
  const eventos: Evento[] = (await new Calendario(userId).listar(ahora, hasta)).filter((e) => !e.todoElDia && e.inicio);

  const { data: conocidos } = await db.from("eventos_avisos").select("evento_id, titulo, inicio")
    .eq("user_id", userId).gte("inicio", ahora.toISOString());
  const porId = new Map((conocidos ?? []).map((c) => [c.evento_id as string, c]));

  let cambios = 0;
  for (const e of eventos) {
    const inicio = new Date(e.inicio);
    const previo = porId.get(e.id);
    porId.delete(e.id);
    if (previo && new Date(previo.inicio).getTime() === inicio.getTime() && previo.titulo === textoSeguro(e.titulo)) continue;
    await programarAvisosEvento(userId, { id: e.id, titulo: e.titulo, inicio, lugar: e.lugar }, h, ahora);
    cambios++;
  }
  // Eventos que desaparecieron del calendario (borrados o movidos fuera de la ventana)
  for (const [id, previo] of porId) {
    if (new Date(previo.inicio) <= hasta) {
      await db.from("recordatorios").update({ estado: "cancelado" }).eq("user_id", userId).eq("evento_id", id).in("estado", ["pendiente", "avisado"]);
      await db.from("eventos_avisos").delete().eq("user_id", userId).eq("evento_id", id);
      cambios++;
    }
  }
  // Limpieza de eventos viejos
  await db.from("eventos_avisos").delete().eq("user_id", userId).lt("inicio", new Date(ahora.getTime() - 86400e3).toISOString());
  return { eventos: eventos.length, cambios };
}
