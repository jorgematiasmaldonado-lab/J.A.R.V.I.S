# ESTADO · J.A.R.V.I.S.

> Archivo que leen Jarvis y Claude Code para saber cómo va el proyecto.
> Lo actualiza Claude Code al final de cada sesión de trabajo (ver `CLAUDE.md`).

**Autor:** Maldonado Jorge Matias
**Última actualización:** 28/11/2026

## Descripción
Asistente personal con IA (voz y texto) al estilo de Jarvis: un cerebro en Supabase (Edge Functions + Gemini) y varios canales (web/PWA y Telegram; luego app Android), con seguridad, memoria y seudonimización de datos personales.

## Avance
**40 %** · **Fase 2 — Organización: código terminado y probado.** Falta desplegarlo, conectar Telegram y Google Calendar, y probarlo en el celular.

## Último trabajo hecho
- Tareas, proyectos y recordatorios que insisten cada 5 minutos hasta que se confirman.
- Agenda con Google Calendar: leer y crear eventos, con avisos la noche anterior, 1 hora y 15 minutos antes.
- Resumen matutino por Telegram y pantalla nueva Hoy.
- Bot de Telegram que solo atiende al dueño, con botones para confirmar.
- El reloj corre dentro de la base y solo llama a una función cuando hay algo que hacer.
- Pruebas de integración con la base real; encontraron y corrigieron tres errores antes de publicar.

## Pendientes
- [ ] Aprobar el despliegue del backend.
- [ ] Crear el bot con BotFather, cargar el token y vincular Telegram.
- [ ] Activar la verificación en dos pasos de Telegram.
- [ ] Configurar Google Calendar en Google Cloud (app publicada, no en modo prueba) y conectarlo.
- [ ] Probar la lista "Organización (Fase 2)" del README.

## Problemas conocidos
- En Chrome de Android el modo manos libres se corta y reinicia. Se resuelve con Porcupine en la Fase 4.
- Los nombres que no estén en "Nombres protegidos" no se ocultan al modelo.
- Los audios de Telegram todavía no se procesan, por privacidad.
- El proyecto de Supabase está en Estados Unidos. Funciona igual, con un poco más de demora.

## Próximos pasos
- **Fase 3:** estado de proyectos con GitHub y ESTADO.md, documentos (empezando por el cronograma de licencias), búsqueda web, noticias, Drive y contactos.
