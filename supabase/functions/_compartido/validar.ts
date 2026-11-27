// =====================================================================
// J.A.R.V.I.S. · Validación estricta de parámetros
// Autor: Maldonado Jorge Matias
//
// Validador mínimo de un subconjunto de JSON Schema (el mismo formato
// que se le declara a Gemini), para no depender de librerías externas.
// Rechaza propiedades desconocidas y tipos incorrectos.
// =====================================================================

export interface Esquema {
  type: "object" | "string" | "integer" | "number" | "boolean" | "array";
  description?: string;
  properties?: Record<string, Esquema>;
  required?: string[];
  items?: Esquema;
  enum?: (string | number)[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  maxItems?: number;
}

export class ErrorValidacion extends Error {}

export function validar(valor: unknown, esquema: Esquema, ruta = "parámetros"): unknown {
  const falla = (msg: string): never => { throw new ErrorValidacion(`${ruta}: ${msg}`); };

  switch (esquema.type) {
    case "object": {
      if (!valor || typeof valor !== "object" || Array.isArray(valor)) falla("se esperaba un objeto");
      const obj = valor as Record<string, unknown>;
      const props = esquema.properties ?? {};
      for (const k of Object.keys(obj)) if (!(k in props)) falla(`propiedad no permitida "${k}"`);
      for (const k of esquema.required ?? []) if (obj[k] === undefined || obj[k] === null) falla(`falta "${k}"`);
      const salida: Record<string, unknown> = {};
      for (const [k, sub] of Object.entries(props)) {
        if (obj[k] !== undefined && obj[k] !== null) salida[k] = validar(obj[k], sub, `${ruta}.${k}`);
      }
      return salida;
    }
    case "string": {
      if (typeof valor !== "string") falla("se esperaba texto");
      const s = valor as string;
      if (esquema.minLength !== undefined && s.length < esquema.minLength) falla("texto demasiado corto");
      if (esquema.maxLength !== undefined && s.length > esquema.maxLength) falla("texto demasiado largo");
      if (esquema.enum && !esquema.enum.includes(s)) falla("valor no permitido");
      return s;
    }
    case "integer":
    case "number": {
      // Gemini a veces manda los números como texto: se acepta "2" pero no "dos"
      const n = typeof valor === "string" && valor.trim() !== "" ? Number(valor) : valor;
      if (typeof n !== "number" || !Number.isFinite(n)) falla("se esperaba un número");
      const num = n as number;
      if (esquema.type === "integer" && !Number.isInteger(num)) falla("se esperaba un entero");
      if (esquema.minimum !== undefined && num < esquema.minimum) falla(`mínimo ${esquema.minimum}`);
      if (esquema.maximum !== undefined && num > esquema.maximum) falla(`máximo ${esquema.maximum}`);
      if (esquema.enum && !esquema.enum.includes(num)) falla("valor no permitido");
      return num;
    }
    case "boolean":
      if (typeof valor !== "boolean") falla("se esperaba verdadero o falso");
      return valor;
    case "array": {
      if (!Array.isArray(valor)) falla("se esperaba una lista");
      const arr = valor as unknown[];
      if (esquema.maxItems !== undefined && arr.length > esquema.maxItems) falla("lista demasiado larga");
      return arr.map((x, i) => validar(x, esquema.items ?? { type: "string" }, `${ruta}[${i}]`));
    }
  }
}
