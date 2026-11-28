// =====================================================================
// J.A.R.V.I.S. · Pruebas de fechas, no molestar y avisos de reuniones
// Autor: Maldonado Jorge Matias
// =====================================================================

import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1.0.13";
import {
  describirCuando, enNoMolestar, finNoMolestar, hoyLocal, localAUtc, offsetMinutos, sumarDias, utcALocal,
} from "../_compartido/tiempo.ts";
import { avisosDeEvento, primerAviso, siguienteAviso } from "../_compartido/avisos.ts";

const CBA = "America/Argentina/Cordoba"; // UTC-3, sin horario de verano
const H = { zona: CBA, noMolestarDesde: "23:00", noMolestarHasta: "07:00" };

Deno.test("conversión hora local ↔ UTC en Córdoba", () => {
  assertEquals(offsetMinutos(new Date("2026-12-04T12:00:00Z"), CBA), -180);
  assertEquals(localAUtc("2026-12-04T09:00", CBA).toISOString(), "2026-12-04T12:00:00.000Z");
  assertEquals(localAUtc("2026-12-04", CBA).toISOString(), "2026-12-04T03:00:00.000Z");
  assertEquals(utcALocal(new Date("2026-12-05T02:30:00Z"), CBA), { fecha: "2026-12-04", hora: "23:30", iso: "2026-12-04T23:30" });
  assertEquals(hoyLocal(CBA, new Date("2026-12-05T02:30:00Z")), "2026-12-04");
});

Deno.test("zona con horario de verano (Madrid) y fechas inválidas", () => {
  assertEquals(localAUtc("2026-07-01T10:00", "Europe/Madrid").toISOString(), "2026-07-01T08:00:00.000Z");
  assertEquals(localAUtc("2026-01-15T10:00", "Europe/Madrid").toISOString(), "2026-01-15T09:00:00.000Z");
  assertThrows(() => localAUtc("mañana a las 9", CBA));
  assertThrows(() => localAUtc("2026-02-31T10:00", CBA));
  assertThrows(() => localAUtc("2026-12-04T25:00", CBA));
});

Deno.test("sumar días cruza meses y años", () => {
  assertEquals(sumarDias("2026-12-31", 1), "2027-01-01");
  assertEquals(sumarDias("2026-03-01", -1), "2026-02-28");
});

Deno.test("no molestar que cruza la medianoche", () => {
  assert(enNoMolestar(localAUtc("2026-12-04T23:30", CBA), CBA, "23:00", "07:00"));
  assert(enNoMolestar(localAUtc("2026-12-05T06:59", CBA), CBA, "23:00", "07:00"));
  assert(!enNoMolestar(localAUtc("2026-12-05T07:00", CBA), CBA, "23:00", "07:00"));
  assert(!enNoMolestar(localAUtc("2026-12-04T15:00", CBA), CBA, "23:00", "07:00"));
  assert(enNoMolestar(localAUtc("2026-12-04T14:00", CBA), CBA, "13:00", "15:00"));
  assertEquals(finNoMolestar(localAUtc("2026-12-04T23:30", CBA), CBA, "07:00").toISOString(), localAUtc("2026-12-05T07:00", CBA).toISOString());
  assertEquals(finNoMolestar(localAUtc("2026-12-05T03:00", CBA), CBA, "07:00").toISOString(), localAUtc("2026-12-05T07:00", CBA).toISOString());
});

Deno.test("describir cuándo, para leer en voz alta", () => {
  const ahora = localAUtc("2026-12-02T10:00", CBA); // miércoles
  assertEquals(describirCuando(localAUtc("2026-12-02T18:30", CBA), CBA, ahora), "hoy a las 18:30");
  assertEquals(describirCuando(localAUtc("2026-12-03T09:05", CBA), CBA, ahora), "mañana a las 9:05");
  assertEquals(describirCuando(localAUtc("2026-12-04T09:00", CBA), CBA, ahora), "el viernes 4 de diciembre a las 9:00");
});

Deno.test("una reunión genera aviso la noche anterior, 1 hora y 15 minutos antes", () => {
  const ahora = localAUtc("2026-12-02T10:00", CBA);
  const av = avisosDeEvento({ titulo: "Reunión con el jefe", inicio: localAUtc("2026-12-04T09:00", CBA), lugar: "el cuartel" }, H, ahora);
  assertEquals(av.map((a) => [a.tipo_aviso, utcALocal(a.cuando, CBA).iso]), [
    ["noche", "2026-12-03T21:00"], ["hora", "2026-12-04T08:00"], ["cuarto", "2026-12-04T08:45"],
  ]);
  assertEquals(av[0].texto, "Recordatorio: mañana a las 9:00 tiene «Reunión con el jefe» (en el cuartel).");
  assertEquals(utcALocal(av[0].limite, CBA).iso, "2026-12-03T23:00"); // la noche no insiste de madrugada
  assertEquals(av[2].limite.toISOString(), localAUtc("2026-12-04T09:00", CBA).toISOString());
  assertEquals(av[1].texto, "En una hora: «Reunión con el jefe» (en el cuartel).");
});

Deno.test("si la reunión está cerca, solo quedan los avisos futuros", () => {
  const ahora = localAUtc("2026-12-04T08:30", CBA);
  const av = avisosDeEvento({ titulo: "X", inicio: localAUtc("2026-12-04T09:00", CBA) }, H, ahora);
  assertEquals(av.map((a) => a.tipo_aviso), ["cuarto"]);
  assertEquals(avisosDeEvento({ titulo: "X", inicio: localAUtc("2026-12-04T08:00", CBA) }, H, ahora), []);
});

Deno.test("insistencia: cada 5 minutos hasta el límite", () => {
  const ahora = localAUtc("2026-12-04T08:45", CBA);
  const limite = localAUtc("2026-12-04T09:00", CBA);
  assertEquals(utcALocal(siguienteAviso({ ahora, insistir: true, limite, esEvento: true }, H)!, CBA).iso, "2026-12-04T08:50");
  assertEquals(siguienteAviso({ ahora: localAUtc("2026-12-04T08:56", CBA), insistir: true, limite, esEvento: true }, H), null);
  assertEquals(siguienteAviso({ ahora, insistir: false, limite, esEvento: true }, H), null);
});

Deno.test("los recordatorios comunes respetan el no molestar; las reuniones no", () => {
  const ahora = localAUtc("2026-12-04T22:57", CBA);
  const sinLimite = { ahora, insistir: true, limite: localAUtc("2026-12-05T12:00", CBA) };
  assertEquals(utcALocal(siguienteAviso({ ...sinLimite, esEvento: false }, H)!, CBA).iso, "2026-12-05T07:00");
  assertEquals(utcALocal(siguienteAviso({ ...sinLimite, esEvento: true }, H)!, CBA).iso, "2026-12-04T23:02");
  assertEquals(utcALocal(primerAviso(localAUtc("2026-12-05T02:00", CBA), false, H), CBA).iso, "2026-12-05T07:00");
  assertEquals(utcALocal(primerAviso(localAUtc("2026-12-05T02:00", CBA), true, H), CBA).iso, "2026-12-05T02:00");
});
