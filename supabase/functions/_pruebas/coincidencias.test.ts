// =====================================================================
// J.A.R.V.I.S. · Pruebas: encontrar la tarea o el recordatorio correcto
// Autor: Maldonado Jorge Matias
// =====================================================================

import { assertEquals } from "jsr:@std/assert@1.0.13";
import { coincidencias, mejorUnico, puntaje } from "../_compartido/coincidencias.ts";

const TAREAS = ["Renovar el seguro del auto", "Llamar al banco por la tarjeta", "Comprar repuestos para la bomba", "Renovar licencia de conducir"];
const t = (x: string) => x;

Deno.test("encuentra la tarea por cómo la nombra el usuario", () => {
  assertEquals(mejorUnico(TAREAS, t, "lo del seguro"), "Renovar el seguro del auto");
  assertEquals(mejorUnico(TAREAS, t, "llamé al banco"), "Llamar al banco por la tarjeta");
  assertEquals(mejorUnico(TAREAS, t, "Comprar repuestos para la bomba"), "Comprar repuestos para la bomba");
  assertEquals(mejorUnico(TAREAS, t, "la bomba"), "Comprar repuestos para la bomba");
});

Deno.test("si es ambiguo no adivina; si no existe, no inventa", () => {
  assertEquals(mejorUnico(TAREAS, t, "renovar"), null); // seguro o licencia
  assertEquals(coincidencias(TAREAS, t, "renovar").length, 2);
  assertEquals(mejorUnico(TAREAS, t, "pasear al perro"), null);
  assertEquals(coincidencias(TAREAS, t, "pasear al perro"), []);
});

Deno.test("ignora acentos y mayúsculas", () => {
  assertEquals(puntaje("Reunión con el Jefe", "reunion con el jefe"), 1);
  assertEquals(mejorUnico(["Llamar a Gómez"], t, "lo de gomez"), "Llamar a Gómez");
});
