// =====================================================================
// J.A.R.V.I.S. · Edge Function "jarvis-acciones"
// Autor: Maldonado Jorge Matias
//
// Lo que la app hace "a mano" y no puede hacer directo en la base:
//   memoria_crear    { texto, categoria }        (calcula el vector)
//   memoria_editar   { id, texto, categoria }    (recalcula el vector)
//   perfil_guardar   { texto }
//   confirmar        { id }   ← única forma de ejecutar una acción sensible
//   cancelar         { id }
// Misma seguridad que jarvis-chat: CORS, JWT, email, MFA (aal2), dueño,
// límites y validación estricta. Todo queda en `actividad`.
// =====================================================================

import { ErrorConfirmacion, resolver } from "../_compartido/confirmaciones.ts";
import { crearEmbeddings } from "../_compartido/llm/embeddings.ts";
import { ErrorLLM } from "../_compartido/llm/tipos.ts";
import { CATEGORIAS, type Categoria, editarMemoria, ErrorMemoria, guardarMemoria, guardarPerfil } from "../_compartido/memoria.ts";
import {
  admin, config, consumirCupo, encabezadosCors, ErrorAcceso, origenPermitido, registrarActividad, respuestaJson,
  verificarUsuario,
} from "../_compartido/seguridad.ts";
import { type EntradaSeudonimo, Seudonimizador } from "../_compartido/seudonimizar.ts";
import { ErrorValidacion, type Esquema, validar } from "../_compartido/validar.ts";

const TAMANO_MAXIMO = 8_000;

const ESQUEMAS: Record<string, Esquema> = {
  memoria_crear: {
    type: "object",
    properties: {
      accion: { type: "string" },
      texto: { type: "string", minLength: 3, maxLength: 1000 },
      categoria: { type: "string", enum: [...CATEGORIAS] },
    },
    required: ["accion", "texto", "categoria"],
  },
  memoria_editar: {
    type: "object",
    properties: {
      accion: { type: "string" },
      id: { type: "integer", minimum: 1 },
      texto: { type: "string", minLength: 3, maxLength: 1000 },
      categoria: { type: "string", enum: [...CATEGORIAS] },
    },
    required: ["accion", "id", "texto", "categoria"],
  },
  perfil_guardar: {
    type: "object",
    properties: { accion: { type: "string" }, texto: { type: "string", maxLength: 2000 } },
    required: ["accion", "texto"],
  },
  confirmar: {
    type: "object",
    properties: { accion: { type: "string" }, id: { type: "string", minLength: 36, maxLength: 36 } },
    required: ["accion", "id"],
  },
  cancelar: {
    type: "object",
    properties: { accion: { type: "string" }, id: { type: "string", minLength: 36, maxLength: 36 } },
    required: ["accion", "id"],
  },
};

Deno.serve(async (req) => {
  try {
    return await atender(req);
  } catch (e) {
    const msg = (e as Error).message ?? "";
    console.error("jarvis-acciones:", msg);
    const configuracion = msg.startsWith("Falta configurar");
    return new Response(JSON.stringify({ error: configuracion ? "configuracion_incompleta" : "error_interno" }), {
      status: configuracion ? 503 : 500,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
});

async function atender(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: origenPermitido(req) ? 204 : 403, headers: encabezadosCors(req) });
  }
  if (!origenPermitido(req)) return respuestaJson(req, 403, { error: "origen_no_permitido" });
  if (req.method !== "POST") return respuestaJson(req, 405, { error: "metodo_no_permitido" });

  let userId: string;
  try {
    userId = (await verificarUsuario(req, "web")).id;
  } catch (e) {
    if (e instanceof ErrorAcceso) return respuestaJson(req, e.estado, { error: e.codigo, mensaje: e.message });
    throw e;
  }

  // --- Cuerpo ------------------------------------------------------------
  let p: Record<string, unknown>;
  try {
    const crudo = await req.text();
    if (crudo.length > TAMANO_MAXIMO) return respuestaJson(req, 413, { error: "mensaje_demasiado_grande" });
    const json = JSON.parse(crudo);
    const esquema = ESQUEMAS[json?.accion];
    if (!esquema) return respuestaJson(req, 400, { error: "peticion_invalida", mensaje: "acción desconocida" });
    p = validar(json, esquema) as Record<string, unknown>;
  } catch (e) {
    const msg = e instanceof ErrorValidacion ? e.message : "JSON inválido";
    return respuestaJson(req, 400, { error: "peticion_invalida", mensaje: msg });
  }

  // --- Límite ------------------------------------------------------------
  const { data: aj } = await admin().from("ajustes").select("zona_horaria").eq("user_id", userId).maybeSingle();
  const zona = aj?.zona_horaria ?? "America/Argentina/Cordoba";
  const cupo = await consumirCupo(userId, "peticion", config.limiteMinuto, config.limiteDia, zona);
  if (!cupo.permitido) return respuestaJson(req, 429, { error: "limite", mensaje: "Demasiadas acciones seguidas." });

  const accion = p.accion as string;
  try {
    switch (accion) {
      case "memoria_crear":
      case "memoria_editar": {
        const emb = crearEmbeddings();
        if (!emb) return respuestaJson(req, 503, { error: "configuracion_incompleta" });
        const { data: lista } = await admin().from("seudonimos").select("id, tipo, valor, alias").eq("user_id", userId);
        const deps = {
          userId, emb, canal: "web",
          seud: new Seudonimizador((lista ?? []) as EntradaSeudonimo[]),
          contarEmb: async () => {
            const c = await consumirCupo(userId, "emb", 60, config.limiteEmbDia, zona);
            if (!c.permitido) throw new ErrorMemoria("se alcanzó el tope diario de la memoria");
          },
        };
        if (accion === "memoria_crear") {
          const r = await guardarMemoria(deps, { texto: p.texto as string, categoria: p.categoria as Categoria, fuente: "manual" });
          await registrarActividad(userId, { tipo: "memoria", herramienta: "memoria_crear", canal: "web", resultado: r });
          return respuestaJson(req, 200, { ok: true, ...r });
        }
        await editarMemoria(deps, { id: p.id as number, texto: p.texto as string, categoria: p.categoria as Categoria });
        await registrarActividad(userId, { tipo: "memoria", herramienta: "memoria_editar", canal: "web", parametros: { id: p.id } });
        return respuestaJson(req, 200, { ok: true });
      }
      case "perfil_guardar":
        await guardarPerfil(userId, p.texto as string);
        await registrarActividad(userId, { tipo: "memoria", herramienta: "perfil_guardar", canal: "web" });
        return respuestaJson(req, 200, { ok: true });
      case "confirmar":
      case "cancelar": {
        const r = await resolver(userId, p.id as string, accion === "confirmar", "web");
        return respuestaJson(req, 200, { ok: true, ...r });
      }
    }
  } catch (e) {
    if (e instanceof ErrorMemoria || e instanceof ErrorConfirmacion || e instanceof ErrorLLM) {
      return respuestaJson(req, 422, { error: "no_se_pudo", mensaje: e.message });
    }
    throw e;
  }
  return respuestaJson(req, 400, { error: "peticion_invalida" });
}
