// =====================================================================
// J.A.R.V.I.S. · Pruebas del validador de parámetros
// Autor: Maldonado Jorge Matias
// =====================================================================

import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.13";
import { ErrorValidacion, type Esquema, validar } from "../_compartido/validar.ts";

const E: Esquema = {
  type: "object",
  properties: {
    dias: { type: "integer", minimum: 0, maximum: 6 },
    nombre: { type: "string", maxLength: 5 },
  },
  required: ["dias"],
};

Deno.test("acepta parámetros válidos y números como texto", () => {
  assertEquals(validar({ dias: "2" }, E), { dias: 2 });
  assertEquals(validar({ dias: 0, nombre: "Ana" }, E), { dias: 0, nombre: "Ana" });
});

Deno.test("rechaza propiedades desconocidas, faltantes y fuera de rango", () => {
  assertThrows(() => validar({ dias: 1, extra: true }, E), ErrorValidacion);
  assertThrows(() => validar({}, E), ErrorValidacion);
  assertThrows(() => validar({ dias: 9 }, E), ErrorValidacion);
  assertThrows(() => validar({ dias: 1.5 }, E), ErrorValidacion);
  assertThrows(() => validar({ dias: "dos" }, E), ErrorValidacion);
  assertThrows(() => validar({ dias: 1, nombre: "demasiado" }, E), ErrorValidacion);
  assertThrows(() => validar([], E), ErrorValidacion);
});
