# ESTADO · J.A.R.V.I.S.

> Archivo que leen Jarvis y Claude Code para saber cómo va el proyecto.
> Lo actualiza Claude Code al final de cada sesión de trabajo (ver `CLAUDE.md`).

**Autor:** Maldonado Jorge Matias
**Última actualización:** 28/11/2026

## Descripción
Asistente personal con IA (voz y texto) al estilo de Jarvis: un cerebro en Supabase (Edge Function + Gemini) y varios canales (web/PWA, luego app Android y Telegram), con seguridad, memoria y seudonimización de datos personales.

## Avance
**25 %** · **Fase 1 — Memoria y conversaciones: código terminado y probado.** Falta desplegarlo y probarlo en el celular.

## Último trabajo hecho
- Memoria de largo plazo: Jarvis guarda lo importante, lo recuerda por significado en cada mensaje y responde "¿qué sabés de…?".
- "Olvidá…" deja una tarjeta Confirmar o Cancelar. Es la base para todas las acciones sensibles futuras.
- Pantallas nuevas: Memoria, con perfil, recuerdos y nombres protegidos, y Actividad.
- El servidor rechaza guardar contraseñas, tarjetas, documentos, CBU y claves.
- Se actualizaron las acciones de GitHub que propuso Dependabot.

## Pendientes
- [ ] Aprobar el despliegue del backend y probar la Fase 1 con la lista del README.
- [ ] Cargar en Memoria los nombres de las personas que conviene proteger.
- [ ] Instalar la app en el celular y probar la voz y el modo manos libres.

## Problemas conocidos
- En Chrome de Android el modo manos libres se corta y reinicia. Se resuelve con Porcupine en la Fase 4.
- Los nombres que no estén en "Nombres protegidos" no se ocultan al modelo.
- El proyecto de Supabase está en Estados Unidos, no en São Paulo. Funciona igual, con un poco más de demora.

## Próximos pasos
- **Fase 2:** tareas, proyectos, recordatorios que insisten, Google Calendar, resumen matutino y bot de Telegram.
