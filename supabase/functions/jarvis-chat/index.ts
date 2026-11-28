// =====================================================================
// J.A.R.V.I.S. · Edge Function "jarvis-chat" (canal web, con streaming)
// Autor: Maldonado Jorge Matias
//
// POST /functions/v1/jarvis-chat
//   Encabezados: Authorization: Bearer <JWT de Supabase (aal2)>
//   Cuerpo: { "mensaje": "…", "canal": "web", "ubicacion": { "lat": -31.4, "lon": -64.5 } }
//
// Responde con Server-Sent Events:
//   event: estado        data: { "texto": "CONSULTANDO SENSORES" }
//   event: texto         data: { "t": "pedacito de respuesta" }
//   event: confirmacion  data: { "id", "resumen", "detalle", "vence" }
//   event: fin           data: { "texto": "respuesta completa", "aviso": null }
//   event: error         data: { "mensaje": "…" }
//
// La conversación en sí está en _compartido/conversacion.ts (la misma
// que usa Telegram).
// =====================================================================

import { conversar, ErrorConversacion, prepararConversacion } from "../_compartido/conversacion.ts";
import {
  encabezadosCors, ErrorAcceso, origenPermitido, respuestaJson, verificarUsuario,
} from "../_compartido/seguridad.ts";
import { ErrorValidacion, type Esquema, validar } from "../_compartido/validar.ts";

const TAMANO_MAXIMO = 16_000; // bytes del cuerpo

const ESQUEMA_PETICION: Esquema = {
  type: "object",
  properties: {
    mensaje: { type: "string", minLength: 1, maxLength: 2000 },
    canal: { type: "string", enum: ["web", "android"] },
    ubicacion: {
      type: "object",
      properties: {
        lat: { type: "number", minimum: -90, maximum: 90 },
        lon: { type: "number", minimum: -180, maximum: 180 },
      },
      required: ["lat", "lon"],
    },
  },
  required: ["mensaje"],
};

// Si falta configuración (un secret), se responde un error claro en vez
// de caerse: el detalle (qué secret falta) queda SOLO en los registros
// de Supabase (Edge Functions → jarvis-chat → Logs), no en la respuesta.
Deno.serve(async (req) => {
  try {
    return await atender(req);
  } catch (e) {
    const msg = (e as Error).message ?? "";
    console.error("jarvis-chat:", msg);
    const configuracion = msg.startsWith("Falta configurar");
    return new Response(JSON.stringify({ error: configuracion ? "configuracion_incompleta" : "error_interno" }), {
      status: configuracion ? 503 : 500,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
});

async function atender(req: Request): Promise<Response> {
  // --- CORS -----------------------------------------------------------
  if (req.method === "OPTIONS") {
    return new Response(null, { status: origenPermitido(req) ? 204 : 403, headers: encabezadosCors(req) });
  }
  if (!origenPermitido(req)) return respuestaJson(req, 403, { error: "origen_no_permitido" });
  if (req.method !== "POST") return respuestaJson(req, 405, { error: "metodo_no_permitido" });

  // --- Autenticación ----------------------------------------------------
  let usuarioId: string;
  try {
    usuarioId = (await verificarUsuario(req, "desconocido")).id;
  } catch (e) {
    if (e instanceof ErrorAcceso) return respuestaJson(req, e.estado, { error: e.codigo, mensaje: e.message });
    throw e;
  }

  // --- Cuerpo -----------------------------------------------------------
  let peticion: { mensaje: string; canal?: string; ubicacion?: { lat: number; lon: number } };
  try {
    const crudo = await req.text();
    if (crudo.length > TAMANO_MAXIMO) return respuestaJson(req, 413, { error: "mensaje_demasiado_grande" });
    peticion = validar(JSON.parse(crudo), ESQUEMA_PETICION) as typeof peticion;
  } catch (e) {
    const msg = e instanceof ErrorValidacion ? e.message : "JSON inválido";
    return respuestaJson(req, 400, { error: "peticion_invalida", mensaje: msg });
  }

  // --- Datos del usuario y límites (antes de abrir el streaming) -------------
  let preparada;
  try {
    preparada = await prepararConversacion(usuarioId, peticion.canal ?? "web");
  } catch (e) {
    if (e instanceof ErrorConversacion) {
      return respuestaJson(req, e.codigo === "limite" ? 429 : 500, { error: e.codigo, mensaje: e.message });
    }
    throw e;
  }

  // --- Respuesta en streaming (SSE) -------------------------------------------
  const codificador = new TextEncoder();
  const cuerpo = new ReadableStream<Uint8Array>({
    async start(controlador) {
      const enviar = (evento: string, datos: unknown) => {
        try { controlador.enqueue(codificador.encode(`event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`)); } catch { /* cliente desconectado */ }
      };
      try {
        const r = await conversar(preparada, {
          mensaje: peticion.mensaje,
          ubicacion: peticion.ubicacion,
          onEstado: (texto) => enviar("estado", { texto }),
          onTexto: (t) => enviar("texto", { t }),
          // Las acciones sensibles aparecen en la app como tarjeta Confirmar / Cancelar
          onConfirmacion: (accion) => enviar("confirmacion", accion),
        });
        enviar("fin", r);
      } catch (e) {
        enviar("error", { mensaje: e instanceof ErrorConversacion ? e.message : "tuve un inconveniente interno" });
      } finally {
        controlador.close();
      }
    },
  });

  return new Response(cuerpo, {
    headers: {
      ...encabezadosCors(req),
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
