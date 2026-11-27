// =====================================================================
// J.A.R.V.I.S. · Selección del proveedor de modelo
// Autor: Maldonado Jorge Matias
//
// Secrets:
//   LLM_PROVEEDOR  "gemini" (por ahora el único)
//   LLM_MODELO     ID exacto del modelo (por defecto gemini-flash-lite-latest)
//   GEMINI_API_KEY clave de Google AI Studio
//   GEMINI_CAPA    "gratuita" (defecto) o "paga". Pasar a la capa paga es
//                  solo cambiar este valor y activar la facturación en
//                  Google; la seudonimización sigue activa igual.
// =====================================================================

import { ProveedorGemini } from "./gemini.ts";
import type { ProveedorLLM } from "./tipos.ts";

export function crearProveedor(): ProveedorLLM {
  const proveedor = Deno.env.get("LLM_PROVEEDOR") ?? "gemini";
  const modelo = Deno.env.get("LLM_MODELO") ?? "gemini-flash-lite-latest";
  switch (proveedor) {
    case "gemini": {
      const clave = Deno.env.get("GEMINI_API_KEY");
      if (!clave) throw new Error("Falta configurar el secret GEMINI_API_KEY");
      return new ProveedorGemini(modelo, clave);
    }
    default:
      throw new Error(`Proveedor de modelo desconocido: ${proveedor}`);
  }
}

export function capaGemini(): "gratuita" | "paga" {
  return Deno.env.get("GEMINI_CAPA") === "paga" ? "paga" : "gratuita";
}

export * from "./tipos.ts";
