// =====================================================================
// J.A.R.V.I.S. · Seudonimización
// Autor: Maldonado Jorge Matias
//
// Antes de enviar cualquier texto al modelo, se reemplazan los datos
// que identifican personas por códigos:
//   [PERSONA_12]  nombres cargados en la tabla `seudonimos` (código estable)
//   [EMAIL_1]     direcciones de email
//   [CUIL_1]      CUIL / CUIT
//   [DNI_1]       documentos
//   [TEL_1]       teléfonos
//   [DIR_1]       direcciones (calle / avenida / ruta + número)
// El modelo razona con los códigos y, en el servidor, `revelar()` los
// vuelve a cambiar por los datos reales antes de responder al usuario.
//
// Limitación conocida: un nombre que NO esté cargado en `seudonimos`
// no se puede detectar con certeza. Por eso la Fase 3 carga
// automáticamente la lista de personal y los contactos.
// =====================================================================

export interface EntradaSeudonimo {
  id: number;
  tipo: "PERSONA" | "LUGAR" | "ORG";
  valor: string;
  alias?: string[];
}

/** Variantes con y sin acento para que "Perez" también encuentre "Pérez". */
const VARIANTES: Record<string, string> = {
  a: "aáàäâ", e: "eéèëê", i: "iíìïî", o: "oóòöô", u: "uúùüû", n: "nñ", c: "cç",
};

function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Construye una expresión que ignora mayúsculas, acentos y espacios repetidos. */
function regexDeNombre(valor: string): RegExp {
  const base = valor.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();
  let patron = "";
  for (const ch of base) {
    if (/\s/.test(ch)) { if (!patron.endsWith("\\s+")) patron += "\\s+"; continue; }
    const v = VARIANTES[ch];
    patron += v ? `[${v}${v.toUpperCase()}]` : escaparRegex(ch);
  }
  // Límites de palabra que funcionan con letras acentuadas
  return new RegExp(`(?<![\\p{L}\\p{N}])${patron}(?![\\p{L}\\p{N}])`, "giu");
}

/** Patrones automáticos, en orden de aplicación (del más específico al más general). */
const PATRONES: { tipo: string; regex: RegExp; valido?: (m: string, texto: string, i: number) => boolean }[] = [
  { tipo: "EMAIL", regex: /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu },
  { tipo: "CUIL", regex: /\b(?:20|23|24|25|26|27|30|33|34)-?\d{8}-?\d\b/g },
  {
    // DNI con puntos (12.345.678) o precedido de "DNI"/"documento"
    tipo: "DNI",
    regex: /(?:\b(?:dni|d\.n\.i\.|documento)(?:\s*(?:n[°ºo.]?|nro\.?|número))?\s*:?\s*\d{1,2}\.?\d{3}\.?\d{3}\b)|(?:\b\d{1,2}\.\d{3}\.\d{3}\b)/giu,
    valido: (m, texto, i) => {
      // "$ 1.500.000" o "1.500.000 pesos" son montos, no documentos
      const antes = texto.slice(Math.max(0, i - 3), i);
      const despues = texto.slice(i + m.length, i + m.length + 8).toLowerCase();
      return !/\$\s*$/.test(antes) && !/^\s*(pesos|ars|usd|d[oó]lares)/.test(despues);
    },
  },
  {
    // Teléfonos: entre 8 y 13 dígitos con separadores opcionales (+54 9 351 123-4567, 3541 15 123456…)
    tipo: "TEL",
    regex: /(?<![\p{L}\p{N}])\+?\(?\d[\d\s\-().]{6,20}\d(?![\p{L}\p{N}])/gu,
    valido: (m) => {
      const digitos = m.replace(/\D/g, "").length;
      if (digitos < 8 || digitos > 13) return false;
      // Evitar fechas y horas tipo 2026-11-27 o 10.30.45
      if (/^\d{4}-\d{2}-\d{2}$/.test(m.trim())) return false;
      if (/^\d{1,2}[.]\d{3}[.]\d{3}$/.test(m.trim())) return false; // eso es un DNI/monto
      return true;
    },
  },
  {
    tipo: "DIR",
    regex: /\b(?:calle|av\.?|avda\.?|avenida|bv\.?|bulevar|boulevard|pasaje|pje\.?|ruta)\s+(?:[\p{L}\p{N}.]+\s+){0,4}?(?:n[°º]?\s*)?\d{1,5}\b/giu,
  },
];

export class Seudonimizador {
  private directo = new Map<string, string>();   // valor real (normalizado) → código
  private inverso = new Map<string, string>();   // código → valor real (tal como apareció)
  private contadores = new Map<string, number>();
  private listas: { regex: RegExp; codigo: string; valor: string }[] = [];
  /** Cantidad de reemplazos hechos (para auditoría, sin guardar los datos). */
  reemplazos = 0;

  constructor(entradas: EntradaSeudonimo[] = []) {
    // Los nombres más largos primero: "Juan Pérez" antes que "Pérez"
    const formas: { forma: string; e: EntradaSeudonimo }[] = [];
    for (const e of entradas) {
      for (const forma of [e.valor, ...(e.alias ?? [])]) {
        if (forma && forma.trim().length >= 2) formas.push({ forma: forma.trim(), e });
      }
    }
    formas.sort((a, b) => b.forma.length - a.forma.length);
    for (const { forma, e } of formas) {
      const codigo = `[${e.tipo}_${e.id}]`;
      this.listas.push({ regex: regexDeNombre(forma), codigo, valor: e.valor });
      this.inverso.set(codigo, e.valor);
    }
  }

  private codigoPara(tipo: string, valor: string): string {
    const clave = `${tipo}|${valor.replace(/\s+/g, " ").trim().toLowerCase()}`;
    let codigo = this.directo.get(clave);
    if (!codigo) {
      const n = (this.contadores.get(tipo) ?? 0) + 1;
      this.contadores.set(tipo, n);
      codigo = `[${tipo}_${n}]`;
      this.directo.set(clave, codigo);
      this.inverso.set(codigo, valor.trim());
    }
    return codigo;
  }

  /** Reemplaza datos personales por códigos. */
  ocultar(texto: string): string {
    if (!texto) return texto;
    let salida = texto;
    // 1) Nombres de la lista privada (códigos estables)
    for (const { regex, codigo } of this.listas) {
      salida = salida.replace(regex, () => { this.reemplazos++; return codigo; });
    }
    // 2) Patrones automáticos
    for (const { tipo, regex, valido } of PATRONES) {
      salida = salida.replace(regex, (m: string, ...rest: unknown[]) => {
        const i = rest.find((x) => typeof x === "number") as number;
        if (valido && !valido(m, salida, i)) return m;
        // No volver a tocar un código ya puesto
        if (/^\[[A-Z]+_\d+\]$/.test(m)) return m;
        // Conservar el espacio inicial que pudo capturar el patrón de teléfono
        const espacio = m.match(/^\s*/)?.[0] ?? "";
        this.reemplazos++;
        return espacio + this.codigoPara(tipo, m.trim());
      });
    }
    return salida;
  }

  /** Aplica ocultar() a todos los textos dentro de un objeto (resultados de herramientas). */
  ocultarObjeto<T>(obj: T): T {
    if (typeof obj === "string") return this.ocultar(obj) as unknown as T;
    if (Array.isArray(obj)) return obj.map((x) => this.ocultarObjeto(x)) as unknown as T;
    if (obj && typeof obj === "object") {
      const r: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) r[k] = this.ocultarObjeto(v);
      return r as T;
    }
    return obj;
  }

  /** Vuelve a poner los datos reales. Tolera que el modelo omita los corchetes. */
  revelar(texto: string): string {
    if (!texto) return texto;
    return texto.replace(/\[?\b([A-Z]{3,7})_(\d{1,6})\b\]?/g, (m, tipo, n) => {
      const real = this.inverso.get(`[${tipo}_${n}]`);
      return real ?? m;
    });
  }

  /** Crea un "revelador" para texto que llega de a pedazos (streaming). */
  revelador(): ReveladorStream {
    return new ReveladorStream(this);
  }
}

/**
 * En streaming, un código puede llegar partido ("[PERSO" + "NA_3]").
 * Este objeto retiene el final del texto mientras pueda ser un código
 * incompleto y entrega el resto ya revelado.
 */
export class ReveladorStream {
  private pendiente = "";
  constructor(private s: Seudonimizador) {}

  agregar(fragmento: string): string {
    this.pendiente += fragmento;
    // Posible código incompleto al final: "[" + hasta 30 caracteres sin "]",
    // o una palabra en mayúsculas que podría ser "PERSONA_1" sin corchetes.
    const m = this.pendiente.match(/(\[[A-Z_0-9]{0,30}|\b[A-Z]{2,7}(?:_\d{0,6})?)$/);
    const corte = m ? this.pendiente.length - m[0].length : this.pendiente.length;
    const listo = this.pendiente.slice(0, corte);
    this.pendiente = this.pendiente.slice(corte);
    return this.s.revelar(listo);
  }

  cerrar(): string {
    const resto = this.s.revelar(this.pendiente);
    this.pendiente = "";
    return resto;
  }
}
