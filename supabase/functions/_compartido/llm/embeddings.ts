// =====================================================================
// J.A.R.V.I.S. · Embeddings (vectores de significado) para la memoria
// Autor: Maldonado Jorge Matias
//
// Convierte un texto en un vector de 768 números: textos con significado
// parecido dan vectores parecidos, y así se buscan recuerdos "por
// significado" con pgvector.
//
// Proveedor: Gemini (modelo EMBEDDINGS_MODELO, por defecto
// gemini-embedding-001). El texto llega YA seudonimizado.
//
// Robustez: sea cual sea el tamaño que devuelva la API, se toman los
// primeros 768 valores y se normaliza (largo 1). Con este modelo la
// reducción de dimensiones funciona justamente recortando el final, así
// que el resultado es el mismo aunque la API ignore outputDimensionality.
// =====================================================================

import { ErrorLLM } from "./tipos.ts";

export const DIMENSIONES = 768;
const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export type TipoEmbedding = "documento" | "consulta";

export interface ProveedorEmbeddings {
  modelo: string;
  vector(texto: string, tipo: TipoEmbedding): Promise<number[]>;
}

/** Recorta a DIMENSIONES y normaliza a largo 1. */
export function ajustarVector(valores: number[]): number[] {
  if (!Array.isArray(valores) || valores.length < DIMENSIONES) {
    throw new ErrorLLM(`el modelo de embeddings devolvió un vector inválido (${valores?.length ?? 0} valores)`);
  }
  const v = valores.slice(0, DIMENSIONES);
  const largo = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  if (!largo || !Number.isFinite(largo)) throw new ErrorLLM("el modelo de embeddings devolvió un vector vacío");
  return v.map((x) => x / largo);
}

/** Formato de texto que entiende pgvector: "[0.1,0.2,…]" */
export function vectorTexto(v: number[]): string {
  return "[" + v.map((x) => (Number.isFinite(x) ? x.toFixed(7) : "0")).join(",") + "]";
}

export class EmbeddingsGemini implements ProveedorEmbeddings {
  constructor(public modelo: string, private clave: string) {}

  async vector(texto: string, tipo: TipoEmbedding): Promise<number[]> {
    let r: Response;
    try {
      r = await fetch(`${BASE}/${encodeURIComponent(this.modelo)}:embedContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": this.clave },
        body: JSON.stringify({
          model: `models/${this.modelo}`,
          content: { parts: [{ text: texto.slice(0, 4000) }] },
          taskType: tipo === "consulta" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT",
          outputDimensionality: DIMENSIONES,
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      throw new ErrorLLM("no pude comunicarme con el servicio de embeddings (" + (e as Error).name + ")");
    }
    if (!r.ok) {
      if (r.status === 429) throw new ErrorLLM("se agotó el cupo gratuito de embeddings por ahora", 429);
      if (r.status === 404) throw new ErrorLLM(`el modelo de embeddings "${this.modelo}" no existe; revise EMBEDDINGS_MODELO`, 404);
      throw new ErrorLLM(`error ${r.status} del servicio de embeddings`, r.status);
    }
    const j = await r.json() as { embedding?: { values?: number[] } };
    return ajustarVector(j.embedding?.values ?? []);
  }
}

/** Crea el proveedor de embeddings, o null si no está configurado. */
export function crearEmbeddings(): ProveedorEmbeddings | null {
  const clave = Deno.env.get("GEMINI_API_KEY");
  if (!clave) return null;
  return new EmbeddingsGemini(Deno.env.get("EMBEDDINGS_MODELO") ?? "gemini-embedding-001", clave);
}
