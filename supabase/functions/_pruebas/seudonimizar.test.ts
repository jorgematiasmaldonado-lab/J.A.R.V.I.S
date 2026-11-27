// =====================================================================
// J.A.R.V.I.S. · Pruebas de la seudonimización
// Autor: Maldonado Jorge Matias
// Ejecutar: deno test supabase/functions/_pruebas
// =====================================================================

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.13";
import { Seudonimizador } from "../_compartido/seudonimizar.ts";

const LISTA = [
  { id: 7, tipo: "PERSONA" as const, valor: "Juan Pérez", alias: ["Pérez", "Juancito"] },
  { id: 9, tipo: "PERSONA" as const, valor: "María Gómez" },
];

Deno.test("reemplaza nombres de la lista, con o sin acentos y mayúsculas", () => {
  const s = new Seudonimizador(LISTA);
  const t = s.ocultar("¿Cuándo vuelve juan perez? Y JUANCITO, ¿y María Gomez?");
  assertEquals(t, "¿Cuándo vuelve [PERSONA_7]? Y [PERSONA_7], ¿y [PERSONA_9]?");
});

Deno.test("el apellido solo también se reemplaza, pero no dentro de otra palabra", () => {
  const s = new Seudonimizador(LISTA);
  assertEquals(s.ocultar("Pérez está de licencia"), "[PERSONA_7] está de licencia");
  assertEquals(s.ocultar("Perezoso no es un apellido"), "Perezoso no es un apellido");
});

Deno.test("emails, CUIL, DNI, teléfonos y direcciones", () => {
  const s = new Seudonimizador();
  const t = s.ocultar(
    "Escribile a ana.lopez@mail.com, CUIL 20-12345678-3, DNI 30.123.456, " +
      "cel +54 9 351 555-1234 o 3541 15 123456. Vive en Av. San Martín 1234.",
  );
  for (const dato of ["ana.lopez@mail.com", "20-12345678-3", "30.123.456", "555-1234", "123456", "San Martín 1234"]) {
    assert(!t.includes(dato), `quedó expuesto: ${dato} → ${t}`);
  }
  assertStringIncludes(t, "[EMAIL_1]");
  assertStringIncludes(t, "[CUIL_1]");
  assertStringIncludes(t, "[DNI_1]");
  assertStringIncludes(t, "[TEL_1]");
  assertStringIncludes(t, "[TEL_2]");
  assertStringIncludes(t, "[DIR_1]");
});

Deno.test("no toca fechas, horas, montos ni temperaturas", () => {
  const s = new Seudonimizador();
  const texto = "El 15/01/2026 a las 10:30 cobré $ 1.500.000 y hacía 28 grados; año 2026.";
  assertEquals(s.ocultar(texto), texto);
});

Deno.test("el mismo dato recibe siempre el mismo código", () => {
  const s = new Seudonimizador();
  const a = s.ocultar("Llamá al 351 555 1234");
  const b = s.ocultar("El 351 555 1234 no atiende");
  assertStringIncludes(a, "[TEL_1]");
  assertStringIncludes(b, "[TEL_1]");
});

Deno.test("revelar devuelve los datos reales, aunque el modelo olvide los corchetes", () => {
  const s = new Seudonimizador(LISTA);
  s.ocultar("mail: ana@x.com");
  assertEquals(s.revelar("Le escribo a [EMAIL_1] por [PERSONA_7]"), "Le escribo a ana@x.com por Juan Pérez");
  assertEquals(s.revelar("PERSONA_9 vuelve el lunes"), "María Gómez vuelve el lunes");
  assertEquals(s.revelar("[PERSONA_99] no existe"), "[PERSONA_99] no existe");
});

Deno.test("streaming: un código partido en varios pedazos se revela bien", () => {
  const s = new Seudonimizador(LISTA);
  const r = s.revelador();
  let salida = "";
  for (const trozo of ["Señor, ", "[PER", "SONA", "_7] vuel", "ve el lunes. ", "PERSO", "NA_9 también."]) {
    salida += r.agregar(trozo);
  }
  salida += r.cerrar();
  assertEquals(salida, "Señor, Juan Pérez vuelve el lunes. María Gómez también.");
});

Deno.test("ocultarObjeto recorre objetos anidados", () => {
  const s = new Seudonimizador(LISTA);
  const o = s.ocultarObjeto({ a: "Juan Pérez", b: [{ c: "tel 351 555 1234" }], n: 3 });
  assertEquals(o, { a: "[PERSONA_7]", b: [{ c: "tel [TEL_1]" }], n: 3 });
});
