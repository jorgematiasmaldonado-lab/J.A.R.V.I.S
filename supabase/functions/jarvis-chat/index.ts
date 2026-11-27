// =====================================================================
// J.A.R.V.I.S. · Edge Function "jarvis-chat" (el cerebro)
// Autor: Maldonado Jorge Matias
//
// POST /functions/v1/jarvis-chat
//   Encabezados: Authorization: Bearer <JWT de Supabase (aal2)>
//   Cuerpo: { "mensaje": "…", "canal": "web", "ubicacion": { "lat": -31.4, "lon": -64.5 } }
//
// Responde con Server-Sent Events:
//   event: estado  data: { "texto": "CONSULTANDO SENSORES" }
//   event: texto   data: { "t": "pedacito de respuesta" }
//   event: fin     data: { "texto": "respuesta completa", "aviso": null }
//   event: error   data: { "mensaje": "…" }
//
// Secrets necesarios (Supabase → Edge Functions → Secrets):
//   GEMINI_API_KEY, ALLOWED_EMAIL, ALLOWED_ORIGINS
// Opcionales: LLM_MODELO, LLM_PROVEEDOR, GEMINI_CAPA,
//   LIMITE_POR_MINUTO, LIMITE_POR_DIA, LIMITE_LLM_POR_DIA
// =====================================================================

import { ejecutarAgente, type MensajeGuardado } from "../_compartido/agente.ts";
import { declaraciones, ejecutarHerramienta, estadoDe } from "../_compartido/herramientas/index.ts";
import type { Ajustes, Contexto } from "../_compartido/herramientas/tipos.ts";
import { capaGemini, crearProveedor, ErrorLLM } from "../_compartido/llm/index.ts";
import { promptSistema } from "../_compartido/prompt.ts";
import {
  admin, config, consumirCupo, encabezadosCors, ErrorAcceso, origenPermitido, registrarActividad, respuestaJson,
  verificarUsuario,
} from "../_compartido/seguridad.ts";
import { type EntradaSeudonimo, Seudonimizador } from "../_compartido/seudonimizar.ts";
import { ErrorValidacion, type Esquema, validar } from "../_compartido/validar.ts";

const TAMANO_MAXIMO = 16_000; // bytes del cuerpo
const MENSAJES_DE_CONTEXTO = 20;

const ESQUEMA_PETICION: Esquema = {
  type: "object",
  properties: {
    mensaje: { type: "string", minLength: 1, maxLength: 2000 },
    canal: { type: "string", enum: ["web", "android", "telegram"] },
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

const AJUSTES_POR_DEFECTO: Ajustes = {
  nombre_trato: "señor", ciudad_base: null, ciudad_lat: null, ciudad_lon: null, zona_horaria: "America/Argentina/Cordoba",
};

class ErrorCupo extends Error {}

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
    console.error(e);
    return respuestaJson(req, 500, { error: "error_interno" });
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
  const canal = peticion.canal ?? "web";
  const mensaje = peticion.mensaje.trim();

  // --- Datos del usuario y límites -------------------------------------------
  const db = admin();
  const [{ data: ajustesDb, error: e1 }, { data: seudonimosDb, error: e2 }, { data: historialDb, error: e3 }] = await Promise.all([
    db.from("ajustes").select("nombre_trato, ciudad_base, ciudad_lat, ciudad_lon, zona_horaria").eq("user_id", usuarioId).maybeSingle(),
    db.from("seudonimos").select("id, tipo, valor, alias").eq("user_id", usuarioId),
    db.from("mensajes").select("rol, contenido").eq("user_id", usuarioId).order("id", { ascending: false }).limit(MENSAJES_DE_CONTEXTO),
  ]);
  for (const e of [e1, e2, e3]) if (e) console.error("Error leyendo datos del usuario:", e.message);
  // Sin la lista de seudónimos no se puede proteger a terceros: mejor no responder
  if (e2) return respuestaJson(req, 500, { error: "error_base" });
  const ajustes: Ajustes = { ...AJUSTES_POR_DEFECTO, ...(ajustesDb ?? {}) };
  const zona = ajustes.zona_horaria;

  try {
    const cupo = await consumirCupo(usuarioId, "peticion", config.limiteMinuto, config.limiteDia, zona);
    if (!cupo.permitido) {
      await registrarActividad(usuarioId, { tipo: "limite", ok: false, canal, parametros: cupo });
      return respuestaJson(req, 429, { error: "limite", mensaje: "Demasiadas consultas seguidas. Espere un momento." });
    }
  } catch (e) {
    console.error(e);
    return respuestaJson(req, 500, { error: "error_interno" });
  }

  const seud = new Seudonimizador((seudonimosDb ?? []) as EntradaSeudonimo[]);
  const historial = ((historialDb ?? []) as MensajeGuardado[]).reverse();
  const ctx: Contexto = { userId: usuarioId, canal, ajustes, ubicacion: peticion.ubicacion };

  // --- Respuesta en streaming (SSE) -------------------------------------------
  const codificador = new TextEncoder();
  let llmHoy = 0;

  const cuerpo = new ReadableStream<Uint8Array>({
    async start(controlador) {
      const enviar = (evento: string, datos: unknown) => {
        try { controlador.enqueue(codificador.encode(`event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`)); } catch { /* cliente desconectado */ }
      };
      const inicio = Date.now();
      try {
        const resultado = await ejecutarAgente({
          proveedor: crearProveedor(),
          seud,
          sistema: promptSistema({ nombreTrato: ajustes.nombre_trato, zonaHoraria: zona, canal }),
          historial,
          mensaje,
          herramientas: declaraciones(),
          ejecutar: (nombre, args) => ejecutarHerramienta(nombre, args, ctx),
          estadoDe,
          antesDeLlamar: async () => {
            const c = await consumirCupo(usuarioId, "llm", 60, config.limiteLlmDia, zona);
            llmHoy = c.dia;
            if (!c.permitido) throw new ErrorCupo("alcanzamos el tope diario de consultas al modelo que usted configuró");
          },
          onEstado: (texto) => enviar("estado", { texto }),
          onTexto: (t) => enviar("texto", { t }),
        });

        const texto = resultado.texto || "Hecho, señor.";

        // Guardar la conversación (datos reales: quedan solo en su base, con RLS)
        const { error: errGuardar } = await db.from("mensajes").insert([
          { user_id: usuarioId, rol: "user", contenido: mensaje, canal },
          { user_id: usuarioId, rol: "model", contenido: texto.slice(0, 8000), canal },
        ]);
        if (errGuardar) console.error("No se guardó la conversación:", errGuardar.message);

        await registrarActividad(usuarioId, {
          tipo: "chat", canal, ok: true,
          parametros: {
            largo_mensaje: mensaje.length,
            pasos: resultado.pasos,
            llamadas_llm: resultado.llamadasLlm,
            herramientas: resultado.herramientasUsadas,
            datos_seudonimizados: seud.reemplazos,
            capa: capaGemini(),
            ms: Date.now() - inicio,
          },
        });

        // Aviso al acercarse al tope diario
        let aviso: string | null = null;
        if (llmHoy >= config.limiteLlmDia * 0.8) {
          aviso = `Lleva ${llmHoy} de ${config.limiteLlmDia} consultas al modelo hoy.`;
        }
        enviar("fin", { texto, aviso });
      } catch (e) {
        let mensajeError = "tuve un inconveniente interno";
        if (e instanceof ErrorLLM || e instanceof ErrorCupo) mensajeError = e.message;
        else console.error(e);
        await registrarActividad(usuarioId, { tipo: "chat", canal, ok: false, resultado: { error: mensajeError } });
        enviar("error", { mensaje: mensajeError });
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
