// =====================================================================
// J.A.R.V.I.S. · Encontrar "la tarea del seguro" entre varias
// Autor: Maldonado Jorge Matias
//
// Cuando el usuario dice "ya hice lo del seguro", hay que encontrar la
// tarea sin exigir el título exacto. Lógica pura, sin base de datos.
// =====================================================================

export function normalizar(t: string): string {
  return t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

const VACIAS = new Set(["de", "del", "la", "las", "el", "los", "lo", "un", "una", "que", "con", "para", "por", "al", "en", "y", "a", "mi", "mis"]);

function palabras(t: string): string[] {
  return normalizar(t).split(" ").filter((p) => p.length >= 3 && !VACIAS.has(p));
}

/** Puntaje 0..1 de qué tan bien `consulta` describe `texto`. */
export function puntaje(texto: string, consulta: string): number {
  const t = normalizar(texto), c = normalizar(consulta);
  if (!c) return 0;
  if (t === c) return 1;
  if (t.includes(c)) return 0.95;
  const pc = palabras(consulta);
  if (!pc.length) return 0;
  const pt = new Set(palabras(texto));
  // Coincidencia por palabra completa o por raíz de 4 letras en palabras largas
  // (seguro / seguros, llamar / llamé, renovar / renovación)
  const raiz = (x: string) => x.length >= 5 ? x.slice(0, 4) : x;
  const aciertos = pc.filter((p) => pt.has(p) || (p.length >= 5 && [...pt].some((x) => x.length >= 5 && raiz(x) === raiz(p)))).length;
  return 0.9 * (aciertos / pc.length);
}

/** Devuelve los elementos que coinciden, del mejor al peor (umbral 0.5). */
export function coincidencias<T>(lista: T[], texto: (x: T) => string, consulta: string, umbral = 0.5): T[] {
  return lista
    .map((x) => ({ x, p: puntaje(texto(x), consulta) }))
    .filter((r) => r.p >= umbral)
    .sort((a, b) => b.p - a.p)
    .map((r) => r.x);
}

/** Si hay un claro ganador (exacto o muy por encima del resto), lo devuelve. */
export function mejorUnico<T>(lista: T[], texto: (x: T) => string, consulta: string): T | null {
  const puntuados = lista.map((x) => ({ x, p: puntaje(texto(x), consulta) })).filter((r) => r.p >= 0.5).sort((a, b) => b.p - a.p);
  if (!puntuados.length) return null;
  if (puntuados.length === 1) return puntuados[0].x;
  return puntuados[0].p - puntuados[1].p >= 0.25 ? puntuados[0].x : null;
}
