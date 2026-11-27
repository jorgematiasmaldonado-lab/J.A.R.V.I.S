# ESTADO · J.A.R.V.I.S.

> Archivo que leen Jarvis y Claude Code para saber cómo va el proyecto.
> Lo actualiza Claude Code al final de cada sesión de trabajo (ver `CLAUDE.md`).

**Autor:** Maldonado Jorge Matias
**Última actualización:** 27/11/2026

## Descripción
Asistente personal con IA (voz y texto) al estilo de Jarvis: un cerebro en Supabase (Edge Function + Gemini) y varios canales (web/PWA, luego app Android y Telegram), con seguridad, memoria y seudonimización de datos personales.

## Avance
**15 %** · **Fase 0 — Seguridad base: terminada y funcionando.** Próxima: Fase 1.

## Último trabajo hecho
- Jarvis quedó publicado en GitHub Pages y responde con Gemini desde el servidor, sin claves en el teléfono.
- Login funcionando con código por email y verificación en dos pasos.
- El despliegue del backend pasa por pruebas, aprobación manual y una verificación de que nada sea público.
- El despliegue usa permisos mínimos: el token de Supabase solo puede publicar funciones.
- Se corrigió un permiso faltante en la base que impedía reconocer al dueño.

## Pendientes
- [x] Configurar Supabase, GitHub y la clave nueva de Gemini.
- [x] Primer ingreso y primera consulta.
- [ ] Borrar la clave vieja de Gemini en AI Studio.
- [ ] Instalar la app en el celular y probar la voz y el modo manos libres.
- [ ] Revisar las actualizaciones de GitHub Actions que propuso Dependabot.

## Problemas conocidos
- En Chrome de Android el modo manos libres se corta y reinicia. Se resuelve con Porcupine en la Fase 4.
- Los nombres que no estén cargados en la tabla de seudónimos no se ocultan al modelo.
- El proyecto de Supabase está en Estados Unidos, no en São Paulo. Funciona igual, con un poco más de demora.

## Próximos pasos
- **Fase 1:** memoria de largo plazo, pantalla Memoria para ver, editar y olvidar, perfil editable y carga de seudónimos desde la app.
