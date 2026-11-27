// =====================================================================
// J.A.R.V.I.S. · Bucle del agente
// Autor: Maldonado Jorge Matias
//
// 1. Arma el contexto (historial reciente + mensaje), seudonimizado.
// 2. Llama al modelo. Si pide herramientas, las ejecuta y repite.
// 3. Máximo MAX_PASOS vueltas.
// 4. Todo el texto que sale hacia el usuario pasa por `revelar()`.
//
// No depende de HTTP ni de la base: recibe todo inyectado, así se puede
// probar con un modelo falso (ver tests/agente.test.ts).
// =====================================================================

import type { Contenido, Parte, ProveedorLLM } from "./llm/tipos.ts";
import type { DeclaracionHerramienta } from "./llm/tipos.ts";
import type { Seudonimizador } from "./seudonimizar.ts";

export const MAX_PASOS = 6;

export interface MensajeGuardado {
  rol: "user" | "model";
  contenido: string;
}

export interface OpcionesAgente {
  proveedor: ProveedorLLM;
  seud: Seudonimizador;
  sistema: string;
  historial: MensajeGuardado[];
  mensaje: string;
  herramientas: DeclaracionHerramienta[];
  ejecutar: (nombre: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  estadoDe: (nombre: string) => string;
  /** Se llama antes de cada llamada al modelo (control de cupo). Si lanza, se corta. */
  antesDeLlamar?: () => Promise<void>;
  onEstado?: (texto: string) => void;
  onTexto?: (delta: string) => void;
}

export interface ResultadoAgente {
  texto: string;
  pasos: number;
  llamadasLlm: number;
  herramientasUsadas: string[];
}

export async function ejecutarAgente(op: OpcionesAgente): Promise<ResultadoAgente> {
  const { seud } = op;

  // Historial: solo texto, empezando siempre por un mensaje del usuario
  const contenidos: Contenido[] = [];
  for (const m of op.historial) {
    if (!contenidos.length && m.rol !== "user") continue;
    contenidos.push({ role: m.rol, parts: [{ text: seud.ocultar(m.contenido) }] });
  }
  contenidos.push({ role: "user", parts: [{ text: seud.ocultar(op.mensaje) }] });

  const herramientasUsadas: string[] = [];
  let llamadasLlm = 0;
  let acumulado = ""; // todo el texto que vio el usuario, en todos los pasos

  for (let paso = 1; paso <= MAX_PASOS; paso++) {
    await op.antesDeLlamar?.();
    llamadasLlm++;

    // El texto se revela de a pedazos a medida que llega
    const revelador = seud.revelador();
    let textoVisible = "";
    const res = await op.proveedor.generar({
      sistema: op.sistema,
      contenidos,
      herramientas: op.herramientas,
      onTexto: (delta) => {
        const listo = revelador.agregar(delta);
        if (listo) { textoVisible += listo; acumulado += listo; op.onTexto?.(listo); }
      },
    });
    const resto = revelador.cerrar();
    if (resto) { textoVisible += resto; acumulado += resto; op.onTexto?.(resto); }

    contenidos.push({ role: "model", parts: res.partes });

    if (!res.llamadas.length) {
      const texto = acumulado.trim() || seud.revelar(res.texto);
      return { texto, pasos: paso, llamadasLlm, herramientasUsadas };
    }

    // Ejecutar las herramientas pedidas
    const respuestas: Parte[] = [];
    for (const ll of res.llamadas) {
      op.onEstado?.(op.estadoDe(ll.nombre));
      herramientasUsadas.push(ll.nombre);
      // Los argumentos pueden traer códigos: se revelan para que la herramienta trabaje con datos reales
      const args = revelarObjeto(seud, ll.args ?? {}) as Record<string, unknown>;
      const resultado = await op.ejecutar(ll.nombre, args);
      // …y el resultado se vuelve a seudonimizar antes de dárselo al modelo
      respuestas.push({
        functionResponse: { name: ll.nombre, response: seud.ocultarObjeto(resultado), ...(ll.id ? { id: ll.id } : {}) },
      });
    }
    contenidos.push({ role: "user", parts: respuestas });
    if (textoVisible) { acumulado += " "; op.onTexto?.(" "); }
  }

  throw new Error("la consulta necesitó demasiados pasos");
}

/** Revela los códigos dentro de todos los textos de un objeto. */
function revelarObjeto(seud: Seudonimizador, obj: unknown): unknown {
  if (typeof obj === "string") return seud.revelar(obj);
  if (Array.isArray(obj)) return obj.map((x) => revelarObjeto(seud, x));
  if (obj && typeof obj === "object") {
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, revelarObjeto(seud, v)]));
  }
  return obj;
}
