# Instrucciones para Claude Code · J.A.R.V.I.S.

Autor del proyecto: **Maldonado Jorge Matias**.

## Reglas del proyecto
- Todo en **español**: código, comentarios, interfaz, mensajes de commit y documentación.
- Cada archivo nuevo lleva en su encabezado: `Autor: Maldonado Jorge Matias`.
- La web **no tiene paso de compilación**: HTML + Tailwind por CDN + JS en módulos. No agregar bundlers.
- Librerías: solo las listadas en el README, con **versión fija y SRI**. Explicar y pedir permiso antes de sumar otra.
- **Ninguna clave en el repositorio, el frontend ni el dispositivo.** Correr `bash scripts/buscar-secretos.sh` antes de cada commit.
- Texto del modelo o de usuarios: siempre `textContent`, nunca `innerHTML`.
- Toda tabla nueva: RLS activada + políticas con `user_id = auth.uid()` y `es_dueno()`; revocar permisos a `anon`; sumarla a `scripts/verificar-publicado.sh`.
- Toda herramienta nueva: módulo propio en `supabase/functions/_compartido/herramientas/`, esquema de parámetros, nivel (`lectura` / `escritura` / `sensible`) y registro en `actividad`.
- Nada que llegue al modelo puede contener datos personales sin pasar por `Seudonimizador.ocultar()`.
- Toda acción **sensible** (borrar, enviar, gastar): la herramienta solo implementa `proponer()`; lo que se ejecuta va en `EJECUTORES` de `confirmaciones.ts` y corre únicamente cuando el dueño toca *Confirmar* (`jarvis-acciones`). Nunca ejecutarla desde el modelo.
- Nunca guardar contraseñas, tarjetas, documentos, CBU ni claves: todo texto que se persista pasa por `motivoProhibido()`.
- Una fase por vez. Antes de programar una fase: plan + decisiones con costo + esperar confirmación.

## Pruebas
```bash
npx deno@2.9.6 test --allow-env supabase/functions/_pruebas
npx deno@2.9.6 check supabase/functions/*/index.ts
npx deno@2.9.6 lint supabase/functions
```

## Al terminar cada sesión de trabajo
Actualizá **`ESTADO.md`** (es lo que lee Jarvis para informar cómo va el proyecto):
1. **Última actualización:** fecha de hoy.
2. **Avance:** porcentaje y fase actual.
3. **Último trabajo hecho:** 3 a 6 viñetas concretas de esta sesión.
4. **Pendientes:** tildar lo terminado, agregar lo nuevo.
5. **Problemas conocidos:** agregar o quitar.
6. **Próximos pasos:** lo siguiente que conviene hacer.
Escribilo en frases cortas que se entiendan leídas en voz alta.
