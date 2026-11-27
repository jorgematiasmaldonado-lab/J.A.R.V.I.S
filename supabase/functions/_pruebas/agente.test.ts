// =====================================================================
// J.A.R.V.I.S. · Pruebas del bucle del agente con un modelo falso
// Autor: Maldonado Jorge Matias
//
// La prueba clave: NINGÚN dato real de la lista privada ni ningún
// teléfono/email aparece en lo que se le envía al modelo, y aun así el
// usuario recibe la respuesta con los datos reales.
// =====================================================================

import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1.0.13";
import { ejecutarAgente, MAX_PASOS } from "../_compartido/agente.ts";
import type { OpcionesGenerar, ProveedorLLM, ResultadoGenerar } from "../_compartido/llm/tipos.ts";
import { Seudonimizador } from "../_compartido/seudonimizar.ts";

const PERSONAL = [
  { id: 1, tipo: "PERSONA" as const, valor: "Carlos Díaz", alias: ["Díaz"] },
  { id: 2, tipo: "PERSONA" as const, valor: "Lucía Fernández" },
];
const DATOS_PROHIBIDOS = ["Carlos", "Díaz", "Diaz", "Lucía", "Fernández", "351 444 9876", "lucia@correo.com"];

/** Modelo falso: guarda todo lo que recibe y responde según un guion. */
class ModeloFalso implements ProveedorLLM {
  nombre = "falso";
  modelo = "falso-1";
  recibido: string[] = [];
  constructor(private guion: ((op: OpcionesGenerar) => ResultadoGenerar)[]) {}
  generar(op: OpcionesGenerar): Promise<ResultadoGenerar> {
    this.recibido.push(JSON.stringify({ sistema: op.sistema, contenidos: op.contenidos, herramientas: op.herramientas }));
    const paso = this.guion.shift();
    if (!paso) throw new Error("guion agotado");
    const r = paso(op);
    // Simula streaming en pedacitos de 4 caracteres
    for (let i = 0; i < r.texto.length; i += 4) op.onTexto?.(r.texto.slice(i, i + 4));
    return Promise.resolve(r);
  }
}

const texto = (t: string): ResultadoGenerar => ({ partes: [{ text: t }], texto: t, llamadas: [] });

Deno.test("ningún dato personal llega al modelo, pero el usuario recibe los reales", async () => {
  const modelo = new ModeloFalso([
    // Paso 1: el modelo pide una herramienta usando el código
    () => ({
      partes: [{ functionCall: { name: "buscar_contacto", args: { persona: "[PERSONA_2]" } } }],
      texto: "",
      llamadas: [{ nombre: "buscar_contacto", args: { persona: "[PERSONA_2]" } }],
    }),
    // Paso 2: responde usando los códigos que recibió
    (op) => {
      const json = JSON.stringify(op.contenidos);
      const tel = json.match(/\[TEL_\d+\]/)?.[0] ?? "?";
      return texto(`Señor, el teléfono de [PERSONA_2] es ${tel}, y [PERSONA_1] vuelve el lunes.`);
    },
  ]);

  let argsRecibidos: Record<string, unknown> = {};
  let streaming = "";
  const res = await ejecutarAgente({
    proveedor: modelo,
    seud: new Seudonimizador(PERSONAL),
    sistema: "Sos Jarvis.",
    historial: [
      { rol: "model", contenido: "Este mensaje del modelo debe descartarse por ir primero" },
      { rol: "user", contenido: "¿Cuándo vuelve Díaz?" },
      { rol: "model", contenido: "Carlos Díaz vuelve el lunes, señor." },
    ],
    mensaje: "Pasame el teléfono de Lucía Fernández",
    herramientas: [{ name: "buscar_contacto", description: "x", parameters: { type: "object", properties: { persona: { type: "string" } } } }],
    ejecutar: (_nombre, args) => {
      argsRecibidos = args;
      return Promise.resolve({ nombre: "Lucía Fernández", telefono: "351 444 9876", email: "lucia@correo.com" });
    },
    estadoDe: () => "BUSCANDO",
    onTexto: (t) => { streaming += t; },
  });

  // 1) Nada prohibido en lo que vio el modelo
  for (const envio of modelo.recibido) {
    for (const dato of DATOS_PROHIBIDOS) assert(!envio.includes(dato), `"${dato}" llegó al modelo: ${envio}`);
  }
  // 2) La herramienta recibió el dato real
  assertEquals(argsRecibidos, { persona: "Lucía Fernández" });
  // 3) El usuario recibió los datos reales, igual por streaming que al final
  assertEquals(res.texto, "Señor, el teléfono de Lucía Fernández es 351 444 9876, y Carlos Díaz vuelve el lunes.");
  assertEquals(streaming.trim(), res.texto);
  assertEquals(res.pasos, 2);
  assertEquals(res.llamadasLlm, 2);
  assertEquals(res.herramientasUsadas, ["buscar_contacto"]);
});

Deno.test("el historial siempre empieza con un mensaje del usuario", async () => {
  const modelo = new ModeloFalso([() => texto("Hola, señor.")]);
  await ejecutarAgente({
    proveedor: modelo, seud: new Seudonimizador(), sistema: "s",
    historial: [{ rol: "model", contenido: "suelto" }],
    mensaje: "hola", herramientas: [], ejecutar: () => Promise.resolve({}), estadoDe: () => "",
  });
  const enviado = JSON.parse(modelo.recibido[0]);
  assertEquals(enviado.contenidos.length, 1);
  assertEquals(enviado.contenidos[0].role, "user");
});

Deno.test("corta después de MAX_PASOS si el modelo no deja de pedir herramientas", async () => {
  const pedir = () => ({
    partes: [{ functionCall: { name: "h", args: {} } }], texto: "", llamadas: [{ nombre: "h", args: {} }],
  });
  const modelo = new ModeloFalso(Array.from({ length: MAX_PASOS + 2 }, () => pedir));
  await assertRejects(() =>
    ejecutarAgente({
      proveedor: modelo, seud: new Seudonimizador(), sistema: "s", historial: [], mensaje: "x",
      herramientas: [], ejecutar: () => Promise.resolve({}), estadoDe: () => "",
    })
  );
  assertEquals(modelo.recibido.length, MAX_PASOS);
});

Deno.test("si el control de cupo lanza, no se llama al modelo", async () => {
  const modelo = new ModeloFalso([() => texto("no debería")]);
  await assertRejects(() =>
    ejecutarAgente({
      proveedor: modelo, seud: new Seudonimizador(), sistema: "s", historial: [], mensaje: "x",
      herramientas: [], ejecutar: () => Promise.resolve({}), estadoDe: () => "",
      antesDeLlamar: () => Promise.reject(new Error("tope")),
    })
  );
  assertEquals(modelo.recibido.length, 0);
});
