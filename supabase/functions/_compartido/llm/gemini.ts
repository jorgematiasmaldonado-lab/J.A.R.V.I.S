// =====================================================================
// J.A.R.V.I.S. · Adaptador para la API de Gemini
// Autor: Maldonado Jorge Matias
//
// - La clave va en el encabezado x-goog-api-key (nunca en la URL).
// - Usa streamGenerateContent con SSE para empezar a responder antes.
// - Configuración (secrets): GEMINI_API_KEY, LLM_MODELO.
//   El ID exacto del modelo se verifica en aistudio.google.com.
// =====================================================================

import { ErrorLLM, type OpcionesGenerar, type Parte, type ProveedorLLM, type ResultadoGenerar } from "./tipos.ts";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/** Forma de cada trozo del flujo SSE de Gemini (solo lo que usamos). */
interface TrozoGemini {
  error?: { message?: string };
  candidates?: { finishReason?: string; content?: { parts?: Parte[] } }[];
}

export class ProveedorGemini implements ProveedorLLM {
  nombre = "gemini";
  constructor(public modelo: string, private clave: string) {}

  async generar(op: OpcionesGenerar): Promise<ResultadoGenerar> {
    const cuerpo: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: op.sistema }] },
      contents: op.contenidos,
      generationConfig: { temperature: op.temperatura ?? 0.8, maxOutputTokens: op.maxTokens ?? 600 },
    };
    if (op.herramientas?.length) cuerpo.tools = [{ functionDeclarations: op.herramientas }];

    let r: Response;
    try {
      r = await fetch(`${BASE}/${encodeURIComponent(this.modelo)}:streamGenerateContent?alt=sse`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": this.clave },
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(45_000),
      });
    } catch (e) {
      throw new ErrorLLM("No pude comunicarme con el modelo (" + (e as Error).name + ")");
    }

    if (!r.ok || !r.body) {
      let detalle = "";
      try { detalle = (await r.json())?.error?.message ?? ""; } catch { /* sin cuerpo */ }
      if (r.status === 429) throw new ErrorLLM("se agotó el cupo gratuito del modelo por ahora", 429);
      if (r.status === 404) throw new ErrorLLM(`el modelo "${this.modelo}" no existe; revise LLM_MODELO`, 404);
      if (r.status === 400 || r.status === 403) throw new ErrorLLM("el modelo rechazó el pedido: " + detalle, r.status);
      throw new ErrorLLM(`error ${r.status} del modelo`, r.status);
    }

    const partes: Parte[] = [];
    let texto = "";
    let motivoFin: string | undefined;

    // Lectura del flujo SSE: líneas "data: {json}"
    const lector = r.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    while (true) {
      const { value, done } = await lector.read();
      if (done) break;
      buffer += value;
      let fin: number;
      while ((fin = buffer.indexOf("\n")) >= 0) {
        const linea = buffer.slice(0, fin).trim();
        buffer = buffer.slice(fin + 1);
        if (!linea.startsWith("data:")) continue;
        let trozo: TrozoGemini;
        try { trozo = JSON.parse(linea.slice(5).trim()); } catch { continue; }
        if (trozo.error) throw new ErrorLLM(trozo.error.message ?? "error del modelo");
        const cand = trozo.candidates?.[0];
        if (cand?.finishReason) motivoFin = cand.finishReason;
        for (const p of (cand?.content?.parts ?? []) as Parte[]) {
          partes.push(p);
          if (p.text && !p.thought) {
            texto += p.text;
            op.onTexto?.(p.text);
          }
        }
      }
    }

    if (!partes.length) {
      if (motivoFin === "SAFETY" || motivoFin === "PROHIBITED_CONTENT") throw new ErrorLLM("el modelo bloqueó la respuesta por seguridad");
      throw new ErrorLLM("respuesta vacía del modelo");
    }

    const llamadas = partes
      .filter((p) => p.functionCall)
      .map((p) => ({ nombre: p.functionCall!.name, args: p.functionCall!.args ?? {}, id: p.functionCall!.id }));

    return { partes, texto: texto.trim(), llamadas, motivoFin };
  }
}
