// =====================================================================
// J.A.R.V.I.S. · Pruebas del adaptador de Gemini (sin red)
// Autor: Maldonado Jorge Matias
//
// Se reemplaza fetch por uno falso que devuelve un flujo SSE cortado en
// lugares incómodos, para verificar la lectura y que la clave viaje en
// el encabezado y no en la URL.
// =====================================================================

import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.13";
import { ProveedorGemini } from "../_compartido/llm/gemini.ts";
import { ErrorLLM } from "../_compartido/llm/tipos.ts";

function sse(trozos: unknown[], cortes = 7): string[] {
  const todo = trozos.map((t) => `data: ${JSON.stringify(t)}\r\n\r\n`).join("");
  const partes: string[] = [];
  for (let i = 0; i < todo.length; i += cortes) partes.push(todo.slice(i, i + cortes));
  return partes;
}

function conFetchFalso(estado: number, cuerpo: string[] | object, prueba: (llamada: { url: string; init: RequestInit }) => Promise<void>) {
  return async () => {
    const original = globalThis.fetch;
    let llamada = { url: "", init: {} as RequestInit };
    globalThis.fetch = ((url: string, init: RequestInit) => {
      llamada = { url, init };
      const body = Array.isArray(cuerpo)
        ? new ReadableStream({ start(c) { for (const p of cuerpo) c.enqueue(new TextEncoder().encode(p)); c.close(); } })
        : JSON.stringify(cuerpo);
      return Promise.resolve(new Response(body, { status: estado }));
    }) as typeof fetch;
    try { await prueba(llamada); } finally { globalThis.fetch = original; }
  };
}

Deno.test("lee texto en streaming, ignora pensamientos y detecta llamadas a herramientas", async () => {
  const cuerpo = sse([
    { candidates: [{ content: { parts: [{ text: "pienso…", thought: true }] } }] },
    { candidates: [{ content: { parts: [{ text: "Buenas tardes, " }] } }] },
    { candidates: [{ content: { parts: [{ text: "señor." }, { functionCall: { name: "obtener_clima", args: { dias_adelante: 1 } } }] }, finishReason: "STOP" }] },
  ]);
  await conFetchFalso(200, cuerpo, async () => {
    const deltas: string[] = [];
    const g = new ProveedorGemini("modelo-x", "CLAVE-SECRETA");
    const r = await g.generar({ sistema: "s", contenidos: [{ role: "user", parts: [{ text: "hola" }] }], onTexto: (d) => deltas.push(d) });
    assertEquals(r.texto, "Buenas tardes, señor.");
    assertEquals(deltas, ["Buenas tardes, ", "señor."]);
    assertEquals(r.llamadas, [{ nombre: "obtener_clima", args: { dias_adelante: 1 }, id: undefined }]);
    assertEquals(r.partes.length, 4); // se conservan todas para reenviarlas
    assertEquals(r.motivoFin, "STOP");
  })();
});

Deno.test("la clave viaja en el encabezado, nunca en la URL", async () => {
  let vista = { url: "", init: {} as RequestInit };
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string, init: RequestInit) => {
    vista = { url, init };
    return Promise.resolve(new Response(sse([{ candidates: [{ content: { parts: [{ text: "ok" }] } }] }]).join(""), { status: 200 }));
  }) as typeof fetch;
  try {
    await new ProveedorGemini("modelo-x", "CLAVE-SECRETA").generar({ sistema: "s", contenidos: [] });
  } finally { globalThis.fetch = original; }
  assertEquals(vista.url.includes("CLAVE-SECRETA"), false);
  assertEquals((vista.init.headers as Record<string, string>)["x-goog-api-key"], "CLAVE-SECRETA");
});

Deno.test("traduce los errores de la API a mensajes entendibles", async () => {
  await conFetchFalso(429, { error: { message: "quota" } }, async () => {
    await assertRejects(() => new ProveedorGemini("m", "k").generar({ sistema: "s", contenidos: [] }), ErrorLLM, "cupo");
  })();
  await conFetchFalso(404, { error: { message: "not found" } }, async () => {
    await assertRejects(() => new ProveedorGemini("m", "k").generar({ sistema: "s", contenidos: [] }), ErrorLLM, "LLM_MODELO");
  })();
});
