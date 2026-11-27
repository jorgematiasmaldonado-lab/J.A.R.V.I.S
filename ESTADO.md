# ESTADO · J.A.R.V.I.S.

> Archivo que leen Jarvis y Claude Code para saber cómo va el proyecto.
> Lo actualiza Claude Code al final de cada sesión de trabajo (ver `CLAUDE.md`).

**Autor:** Maldonado Jorge Matias
**Última actualización:** 27/11/2026

## Descripción
Asistente personal con IA (voz y texto) al estilo de Jarvis: un cerebro en Supabase (Edge Function + Gemini) y varios canales (web/PWA, luego app Android y Telegram), con seguridad, memoria y seudonimización de datos personales.

## Avance
**10 %** · Fase actual: **Fase 0 — Seguridad base** (código terminado; falta la configuración de cuentas).

## Último trabajo hecho
- Edge Function `jarvis-chat`: verificación de JWT, email, MFA y dueño; CORS; límites; bucle de herramientas (máx. 6) con streaming; adaptador de modelo desacoplado.
- Seudonimización y reidentificación (también en streaming), con pruebas automáticas.
- Esquema de base con RLS: `dueno`, `ajustes`, `mensajes`, `actividad`, `seudonimos`, `uso_contadores`.
- PWA con la estética del reactor: login con código + TOTP, chat sincronizado, voz por frases, manos libres mejorado, CSP y SRI.
- Workflows: pruebas + despliegue de Supabase, publicación en Pages, búsqueda de secretos, Dependabot.

## Pendientes
- [ ] Configurar Supabase, GitHub y la clave nueva de Gemini (README, pasos 1 a 8).
- [ ] Rotar y borrar la clave vieja de Gemini.
- [ ] Hacer las pruebas manuales del README en el celular y en la compu.

## Problemas conocidos
- En Chrome de Android el modo manos libres se corta y reinicia (limitación del navegador). Se resuelve con Porcupine en la Fase 4.
- Los nombres que no estén cargados en `seudonimos` no se ocultan al modelo.

## Próximos pasos
- **Fase 1:** memoria de largo plazo (pgvector), pantalla Memoria (ver, editar, olvidar), perfil editable, carga de seudónimos desde la app.
