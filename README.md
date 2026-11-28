# J.A.R.V.I.S.

Asistente personal con inteligencia artificial, al estilo de Jarvis.
**Autor:** Maldonado Jorge Matias · JMM Gestiones & Tecnología
**Estado:** Fase 2 (organización: tareas, recordatorios, agenda y Telegram). Ver [`ESTADO.md`](ESTADO.md) y [`SEGURIDAD.md`](SEGURIDAD.md).

---

## Qué cambió respecto de la versión anterior

| Antes (`index.html` único) | Ahora (Fase 0) |
|---|---|
| Clave de Gemini en `localStorage` y en la URL | **Ninguna clave en el dispositivo.** La clave vive en los secrets de Supabase y viaja en un encabezado |
| Cualquiera con la página podía usarla | Login con **código por email + app de autenticación (TOTP)**, un solo usuario permitido |
| Historial en texto plano en el teléfono | Historial en Supabase con **RLS**, sincronizado entre dispositivos |
| GPS exacto enviado a dos servicios externos | Ubicación redondeada a ~1 km, solo a Open-Meteo y desde el servidor (o una "ciudad base") |
| Sin CSP; Tailwind sin versión | **CSP estricta**, librerías con versión fija y **SRI** |
| Nombres reales enviados al modelo | **Seudonimización**: el modelo ve `[PERSONA_3]`, `[TEL_1]`… |
| No instalable | PWA instalable (manifest + service worker) |
| Respuesta completa antes de hablar | **Streaming**: empieza a hablar con la primera frase |

## Arquitectura

```
 Navegador (GitHub Pages)                    Supabase
 ┌──────────────────────┐   JWT (aal2)   ┌──────────────────────────────────────┐
 │ index.html + js/     │ ─────────────▶ │ Edge Function jarvis-chat            │
 │ reactor, voz, chat   │ ◀── SSE ────── │  ├ verifica JWT, email, MFA, dueño   │
 │ (sin claves)         │                │  ├ límites por minuto y por día      │
 └─────────┬────────────┘                │  ├ seudonimiza ──▶ Gemini (clave en  │
           │ RLS (solo dueño + aal2)     │  │                   secrets)         │
           └───────────────────────────▶ │  ├ herramientas (clima: Open-Meteo)  │
                                         │  └ reidentifica y responde           │
                                         │ Postgres + RLS: ajustes, mensajes,   │
                                         │ actividad, seudonimos, contadores    │
                                         └──────────────────────────────────────┘
```

## Estructura

```
web/                         lo que se publica en GitHub Pages
  index.html                 pantallas: carga, login, app, ajustes
  css/jarvis.css             el reactor
  js/config.js               URL y clave PÚBLICA (las completa el workflow)
  js/supa.js · auth.js       cliente de Supabase, login + MFA
  js/api.js                  llamada a jarvis-chat (SSE) y tablas
  js/voz.js                  hablar (por frases) y escuchar (manos libres)
  js/ui.js · app.js          interfaz, tarjetas de confirmación y flujo principal
  js/paneles.js              pantallas Memoria (perfil, recuerdos, nombres) y Actividad
  js/organizacion.js         pantalla Hoy, conexiones (Google, Telegram) y avisos en la app
  manifest.webmanifest · sw.js · icons/ · img/
supabase/
  migrations/                esquema, RLS y funciones SQL
  functions/jarvis-chat/     el cerebro (charla, herramientas, memoria automática)
  functions/jarvis-acciones/ recuerdos, perfil, tareas, agenda de hoy, vínculo de Telegram, confirmar/cancelar
  functions/jarvis-cron/     el reloj: avisos con insistencia, resumen matutino, sincronizar calendario
  functions/jarvis-telegram/ webhook del bot (solo atiende al dueño)
  functions/jarvis-google/   conectar Google Calendar (OAuth con PKCE)
  functions/_compartido/     seguridad, agente, seudonimización, LLM, embeddings,
                             memoria, confirmaciones, herramientas
  functions/_pruebas/        pruebas automáticas (deno test)
  tests/verificar_seguridad.sql
scripts/                     buscar-secretos, configurar-web, verificar-publicado
.github/workflows/           pages (web), supabase (backend), secretos
```

---

## Puesta en marcha (paso a paso)

> **Regla de oro:** las claves se pegan **solo** en Supabase o en GitHub (en los lugares que se indican). Nunca en el código, en un chat ni en un mensaje.

### Paso 0 · Parche de la clave vieja (hacerlo ya)

1. En [aistudio.google.com](https://aistudio.google.com) → **API keys**, mirá a qué proyecto de Google Cloud pertenece tu clave.
2. En [console.cloud.google.com](https://console.cloud.google.com) → ese proyecto → **APIs y servicios → Credenciales** → abrí la clave:
   - **Restricciones de API:** "Restringir clave" → solo **Generative Language API**.
   - **Restricciones de aplicación:** "Sitios web" → `https://jorgematiasmaldonado-lab.github.io/*`.
3. **Facturación:** si el proyecto no tiene cuenta de facturación, no puede generar costos. Si la tiene: **Facturación → Presupuestos y alertas** → presupuesto de USD 1 con alertas al 50/90/100 %.
4. Hasta terminar la Fase 0, no le cuentes a Jarvis datos de terceros.

### Paso 1 · Repositorio

1. Repositorio **público** `J.A.R.V.I.S` en GitHub (ya creado) (Pages gratis requiere repo público; el código no tiene secretos).
2. En **Settings → Code security**, activá **Secret scanning** y **Push protection** (gratis en repos públicos).
3. En **Settings → Pages → Source**, elegí **GitHub Actions**.

### Paso 2 · Proyecto de Supabase

1. Entrá a [supabase.com](https://supabase.com) → **New project**.
   - Nombre: `jarvis` · Región: **South America (São Paulo)** · Plan: Free.
   - Generá una contraseña de base de datos fuerte y **guardala en tu gestor de contraseñas**.
2. Cuando termine, anotá (no son secretos, pero tampoco hace falta publicarlos):
   - **Project URL**: `https://<ref>.supabase.co` (en *Project Settings → Data API*).
   - **Project ref**: las letras de esa URL.
   - **Publishable key** (`sb_publishable_…`) en *Project Settings → API Keys*. Si tu proyecto muestra solo claves "legacy", usá la **anon** (nunca la `service_role`).

### Paso 3 · Autenticación (un solo usuario, con MFA)

En Supabase → **Authentication**:

1. **Users → Add user → Create new user**: tu email, una contraseña larga al azar (no se va a usar) y tildá **Auto Confirm User**.
2. **Sign In / Providers**:
   - **Email**: habilitado.
   - **Allow new users to sign up**: **desactivado** (nadie más puede crear cuenta).
3. **Emails → Templates → Magic Link**: reemplazá el cuerpo por:
   ```html
   <h2>J.A.R.V.I.S.</h2>
   <p>Su código de acceso es: <strong>{{ .Token }}</strong></p>
   <p>Si no lo pidió usted, ignore este mensaje.</p>
   ```
   (Así llega un **código** en lugar de un enlace: la app no acepta enlaces de login.)
4. **URL Configuration → Site URL**: `https://jorgematiasmaldonado-lab.github.io/J.A.R.V.I.S/`
5. **Multi-Factor**: verificá que **TOTP** esté habilitado (viene activado).

### Paso 4 · Secrets de la Edge Function

1. En Google AI Studio creá una **clave nueva** de Gemini. En Google Cloud restringila **solo a Generative Language API**, sin restricción de sitio web (la usa el servidor, no el navegador).
2. En Supabase → **Edge Functions → Secrets**, agregá:

| Nombre | Valor | |
|---|---|---|
| `GEMINI_API_KEY` | la clave nueva | obligatorio |
| `ALLOWED_EMAIL` | tu email | obligatorio |
| `ALLOWED_ORIGINS` | `https://jorgematiasmaldonado-lab.github.io` (sin `/J.A.R.V.I.S`, sin barra final) | obligatorio |
| `LLM_MODELO` | `gemini-flash-lite-latest` (o el ID exacto que figure en AI Studio) | opcional |
| `LIMITE_LLM_POR_DIA` | un poco menos que el límite diario gratuito que muestra AI Studio para tu modelo (*Rate limits*) | recomendado |
| `LIMITE_POR_MINUTO` / `LIMITE_POR_DIA` | por defecto 10 y 300 mensajes | opcional |

`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` las pone Supabase sola.

### Paso 5 · GitHub: secrets, variables y despliegue

1. **Settings → Environments → New environment** `produccion`. Recomendado: *Required reviewers* = vos (aprobás cada despliegue) y *Deployment branches* = solo `main`.
2. **Token de Supabase con permisos mínimos:** Supabase → tu avatar → **Access Tokens → Generate new token**, nombre `github-jarvis`. Si te deja elegir permisos, marcá **solo** `edge_functions_read` y `edge_functions_write`, limitado a este proyecto.
3. **Cadena de conexión:** en el panel del proyecto, botón **Connect** (arriba) → **Session pooler** → copiá la cadena `postgresql://postgres.xxxx:[YOUR-PASSWORD]@…pooler.supabase.com:5432/postgres` **dejando el marcador `[YOUR-PASSWORD]` (o `[YOUR-DATABASE-PASSWORD]`) tal cual**.
4. En **Settings → Environments → produccion**:
   - **Environment secrets:** `SUPABASE_ACCESS_TOKEN` (el token), `SUPABASE_DB_PASSWORD` (la contraseña de la base), `SUPABASE_PROJECT_REF` (las 20 letras del proyecto; acepta también la URL).
   - **Environment variables:** `SUPABASE_DB_CONEXION` (la cadena del punto 3).
5. En **Settings → Secrets and variables → Actions → Variables** (del repositorio): `SUPABASE_URL` y `SUPABASE_CLAVE_PUBLICA` (la *publishable*).
6. **Actions → Backend → Run workflow**. Corre las pruebas, aplica la base de datos, publica la función y verifica que nada sea público. Todo tiene que quedar en verde.
7. **Actions → Publicar web → Run workflow**. Al terminar, la app queda en `https://jorgematiasmaldonado-lab.github.io/J.A.R.V.I.S/`.

> El workflow de la web **se niega a publicar** si la clave cargada es secreta.

### Paso 6 · Registrar al dueño

Supabase → **SQL Editor** → nueva consulta:

```sql
insert into public.dueno (user_id)
select id from auth.users where email = 'SU_EMAIL_AQUÍ';
```

Después pegá y ejecutá [`supabase/tests/verificar_seguridad.sql`](supabase/tests/verificar_seguridad.sql): **todas las filas tienen que decir OK**.

### Paso 7 · Primer ingreso

1. Abrí la app (celular o compu) → tu email → **Enviar código**.
2. Pegá el código del email (mirá también en spam).
3. Escaneá el QR con tu app de autenticación (Aegis, 2FAS o Google Authenticator) y escribí el código de 6 dígitos.
4. En el celular: menú de Chrome → **Instalar app** / **Agregar a pantalla principal**.
5. **Ajustes**: cómo te llama, ciudad base, voz.

### Paso 8 · Cerrar la puerta vieja

1. En Google AI Studio **borrá la clave vieja**.
2. Abrí la app nueva en cada dispositivo donde usabas la anterior: borra sola la clave vieja y el historial que estaban guardados.

---

## Memoria (Fase 1)

- **Jarvis recuerda solo:** cuando le contás algo duradero ("Mi jefe es Gómez"), lo guarda y dice *"Tomo nota"*. En cada mensaje busca los recuerdos relacionados **por significado** (no por palabras exactas) y los tiene en cuenta.
- **"¿Qué sabés de X?"** → lista lo que recuerda.
- **"Olvidá X"** → aparece una **tarjeta Confirmar / Cancelar**. Hasta que no tocás Confirmar, no se borra nada. La tarjeta vence a los 15 minutos.
- **Nunca guarda** contraseñas, PIN, tarjetas, documentos, CUIL, CBU ni claves: el servidor lo rechaza aunque el modelo lo intente.
- **Pantalla Memoria:**
  - **Perfil:** un texto sobre vos que Jarvis siempre tiene en cuenta.
  - **Recuerdos:** buscar, agregar, editar y borrar.
  - **Nombres protegidos:** las personas cuyo nombre nunca llega a Gemini (se reemplaza por `[PERSONA_3]`). Agregá también otras formas de nombrarlas ("Pérez", "Juancito").
- **Pantalla Actividad:** todo lo que hizo Jarvis (consultas, herramientas, confirmaciones, accesos denegados), sin el texto de tus mensajes.

**Cómo funciona por dentro:** cada recuerdo se guarda con un *embedding* (768 números que representan su significado) calculado por Gemini (`gemini-embedding-001`) sobre el texto **seudonimizado**, y se busca con pgvector en Supabase.

Secrets opcionales nuevos (Supabase → Edge Functions → Secrets):

| Nombre | Por defecto | Para qué |
|---|---|---|
| `LIMITE_EMB_POR_DIA` | 800 | Tope diario de llamadas de memoria (1 por mensaje + 1 por recuerdo guardado) |
| `MEMORIA_UMBRAL` | 0.6 | Qué tan parecido debe ser un recuerdo para usarlo (más alto = más estricto) |
| `EMBEDDINGS_MODELO` | `gemini-embedding-001` | Modelo de embeddings |

> Si agregás un nombre protegido **después** de tener recuerdos sobre esa persona, la búsqueda de esos recuerdos puede funcionar un poco peor. Editarlos (botón Editar → Guardar) recalcula su significado.

## Organización (Fase 2)

**Qué hace:**
- **Tareas:** *"Anotá renovar el seguro para el viernes"*, *"¿Qué tengo pendiente?"*, *"Ya hice lo del seguro"*. También desde la pantalla **Hoy**.
- **Proyectos:** *"Registrá el proyecto Gestión de personal ETAC, también le digo ETAC"*. Las tareas se pueden asociar a un proyecto.
- **Recordatorios que insisten:** *"Recordame mañana a las 10 llamar al banco"*. Avisa por Telegram (con botón **Entendido**) y en la app abierta. Si no confirmás, repite cada 5 minutos, hasta 2 horas. En el horario de *no molestar* espera, salvo las reuniones.
- **Agenda (Google Calendar):** *"¿Qué tengo mañana?"*, *"Agendá reunión con el jefe el jueves a las 9 en el cuartel"*. Si falta la hora o el lugar, pregunta.
- **Reuniones a prueba de olvidos:** cada evento con hora del calendario recibe aviso **la noche anterior (21:00), 1 hora antes y 15 minutos antes**, con insistencia hasta que empiece.
- **Resumen matutino** a la hora elegida, por Telegram y en la pantalla **Hoy** (con botón *Escuchar*).
- **Bot de Telegram:** el mismo Jarvis y la misma memoria. Solo te responde a vos; a cualquier otro lo ignora y lo registra. Las acciones sensibles se confirman con botones. Los audios no se procesan todavía (por privacidad): usá el micrófono del teclado.

### Configurar Telegram (10 minutos)

1. En Telegram, abrí **@BotFather** → `/newbot` → nombre `Jarvis` → usuario que termine en `bot` (ej.: `jmm_jarvis_bot`). Copiá el **token** que te da (no lo pegues en ningún chat).
2. En @BotFather: `/setjoingroups` → elegí tu bot → **Disable** (nadie puede meterlo en grupos).
3. **Supabase → Edge Functions → Secrets:** agregá `TELEGRAM_BOT_TOKEN` con el token.
4. **Seguridad:** en Telegram, *Ajustes → Privacidad y seguridad → Verificación en dos pasos* → activala. Tu cuenta de Telegram pasa a ser una llave de Jarvis.
5. En Jarvis: **Ajustes → Conexiones → Telegram → Vincular** → abrí el enlace en el celular → **Iniciar**. Jarvis te confirma por Telegram. El enlace sirve una vez y vence en 15 minutos.

### Configurar Google Calendar (15 minutos)

1. [console.cloud.google.com](https://console.cloud.google.com) → tu proyecto (puede ser el mismo de Gemini) → **APIs y servicios → Biblioteca** → buscá **Google Calendar API** → **Habilitar**.
2. **Google Auth Platform** (o *Pantalla de consentimiento de OAuth*):
   - Tipo de usuario: **Externo**. Nombre de la app: `J.A.R.V.I.S.`; correo de asistencia y de contacto: el tuyo.
   - **Acceso a datos / Permisos:** agregá solo `https://www.googleapis.com/auth/calendar.events`.
   - **Público:** tocá **Publicar app** → *En producción*. Esto es importante: en modo *Prueba* el permiso **vence cada 7 días**. Google va a advertir que la app no está verificada; para uso personal no hace falta verificarla.
3. **Clientes / Credenciales → Crear credenciales → ID de cliente de OAuth → Aplicación web**:
   - **URI de redireccionamiento autorizado:** `https://<tu-proyecto>.supabase.co/functions/v1/jarvis-google` (las 20 letras de tu proyecto).
   - Copiá el **ID de cliente** y el **Secreto del cliente**.
4. **Supabase → Edge Functions → Secrets:**
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
   - `APP_URL` = `https://jorgematiasmaldonado-lab.github.io/J.A.R.V.I.S/`
5. En Jarvis: **Ajustes → Conexiones → Google Calendar → Conectar** → elegí tu cuenta → en la advertencia *"Google no verificó esta app"*: **Configuración avanzada → Ir a J.A.R.V.I.S.** → permití el acceso al calendario. Volvés a Jarvis con el mensaje *"Google Calendar conectado"*.

Para revocar el acceso en cualquier momento: Ajustes → Conexiones → **Desconectar**, o desde [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

### Secrets opcionales nuevos

| Nombre | Por defecto | Para qué |
|---|---|---|
| `LIMITE_ACCIONES_POR_MINUTO` / `_POR_DIA` | 40 / 2000 | Acciones de la app (tildar tareas, abrir pantallas), separadas del límite del chat |

### Cómo funciona el reloj

`pg_cron` revisa **cada minuto dentro de la base** si hay recordatorios vencidos, un resumen pendiente o si pasaron 15 minutos desde la última sincronización del calendario. Solo en ese caso llama a la función `jarvis-cron`, con un secreto que se genera dentro de la base (nadie lo copia a mano). El workflow *Backend* le indica la dirección del proyecto en el paso *Configurar el reloj*.

## Pruebas manuales

**En la compu (Chrome o Edge):**
- [ ] Login completo: email → código → QR → código TOTP.
- [ ] Cerrar sesión y volver a entrar: pide código y TOTP (no el QR).
- [ ] "¿Cómo está el clima hoy?" → responde con datos reales y lo dice en voz alta.
- [ ] "¿Y mañana?" → recuerda el contexto.
- [ ] Tocar el reactor mientras habla → se calla.
- [ ] Recargar la página → la conversación sigue ahí.
- [ ] Ajustes → Borrar charla → desaparece también en el celular.
- [ ] Herramientas de desarrollador → *Application → Local Storage*: **no** hay ninguna clave de Gemini.
- [ ] Abrir la URL en una ventana de incógnito: pide login y no muestra nada.

**En el celular (Chrome Android):**
- [ ] Instalar como app; abre sin barra del navegador.
- [ ] Reactor → hablar → responde por voz (es-AR).
- [ ] Manos libres: "Jarvis, ¿qué hora es?" → responde. Decir solo "Jarvis" → "¿Sí, señor?".
- [ ] Con la ubicación desactivada y ciudad base cargada, el clima usa la ciudad base.
- [ ] **Cerrar en todos** desde la compu → el celular vuelve al login en la próxima consulta.

**Memoria (Fase 1):**
- [ ] "Mi jefe se llama …" → responde "Tomo nota" y aparece en *Memoria → Recuerdos*.
- [ ] Recargar y preguntar "¿Quién me supervisa?" → lo recuerda sin que se lo repitas.
- [ ] "¿Qué sabés de mi jefe?" → lista lo guardado.
- [ ] "Olvidá lo de mi jefe" → aparece la tarjeta; **Cancelar** no borra nada; repetir y **Confirmar** lo borra.
- [ ] "Acordate de que la contraseña del wifi es 1234" → se niega por seguridad.
- [ ] Memoria → agregar, editar y borrar un recuerdo a mano; guardar el perfil.
- [ ] Memoria → proteger un nombre y preguntar algo con ese nombre: en *Actividad* la consulta muestra "dato(s) protegidos".
- [ ] Cerrar sesión y abrir en el celular: los recuerdos están ahí.

**Organización (Fase 2):**
- [ ] Ajustes → Conexiones → **Vincular Telegram** → Iniciar → llega la bienvenida.
- [ ] Desde otra cuenta de Telegram, escribirle al bot → **no responde**; en *Actividad* aparece "Acceso denegado".
- [ ] "Recordame en 2 minutos tomar agua" → llega por Telegram con botón **Entendido**; sin tocarlo, a los 5 minutos insiste; al tocarlo, deja de insistir.
- [ ] "Anotá comprar repuestos para el lunes" → aparece en **Hoy**; tildarla la marca como hecha.
- [ ] Ajustes → Conexiones → **Conectar Google** → vuelve con "conectado".
- [ ] "¿Qué tengo mañana?" → lee la agenda real.
- [ ] "Agendá reunión con el jefe" (sin hora) → **pregunta la hora** antes de crearla.
- [ ] Crear una reunión para dentro de 1 h 20 min → a los 20 min llega "En una hora…" y a los 65 min "En 15 minutos…".
- [ ] **Hoy → Generar ahora** → llega el resumen por Telegram.
- [ ] Por Telegram: "Borrá la tarea de los repuestos" → llegan botones **Confirmar / Cancelar**.
- [ ] Mandarle un audio por Telegram → explica que use el dictado del teclado.

**Seguridad:**
- [ ] En *Actions → Backend*, el paso "Verificar que nada sea público" está en verde.
- [ ] `verificar_seguridad.sql` → todo OK.
- [ ] En Supabase → *Table Editor → actividad* aparecen los chats y herramientas, sin el texto de los mensajes.

## Costos (Fases 0 a 2)

| Servicio | Plan | Costo |
|---|---|---|
| GitHub (repo + Pages + Actions) | Gratis (repo público) | USD 0 |
| Supabase | Free | USD 0 · los proyectos inactivos se pausan (hoy, tras ~7 días; ver supabase.com/pricing) y se reactivan desde el panel |
| Gemini API (charla) | Capa gratuita | USD 0 · con límites por minuto y por día; **Google puede usar los datos de la capa gratuita para mejorar sus productos** (por eso la seudonimización) |
| Gemini API (embeddings de memoria) | Capa gratuita | USD 0 · límite diario propio; Jarvis lo cuenta con `LIMITE_EMB_POR_DIA` |
| pgvector | Incluido en Supabase | USD 0 |
| pg_cron y pg_net (el reloj) | Incluidos en Supabase | USD 0 · solo llama a una función cuando hay algo que hacer (unas 3.000 llamadas al mes; el plan gratis incluye 500.000) |
| Telegram Bot API | Gratis | USD 0 |
| Google Calendar API | Gratis | USD 0 |
| Open-Meteo | Gratis, uso no comercial | USD 0 |
| **Total** | | **USD 0 / mes** |

Pasar a la capa paga de Gemini: activar facturación en Google Cloud y poner `GEMINI_CAPA=paga` en los secrets. Nada más cambia.

## Actualizar una librería del CDN

Las librerías tienen versión fija y hash SRI. Para actualizar, por ejemplo, supabase-js:

```bash
V=2.120.0   # versión nueva, con al menos 2 semanas de publicada
curl -sL "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@$V/dist/umd/supabase.js" \
  | openssl dgst -sha384 -binary | openssl base64 -A
```

Reemplazar la versión y el `integrity` en `web/index.html`, y la versión en `supabase/functions/_compartido/seguridad.ts`.

## Desarrollo local (opcional)

```bash
# Pruebas del backend (no necesita instalar nada más que Node)
npx deno@2.9.6 test supabase/functions/_pruebas
# Buscar secretos antes de subir (o instalarlo como hook)
bash scripts/buscar-secretos.sh
cp scripts/buscar-secretos.sh .git/hooks/pre-commit
```

## Problemas frecuentes

| Síntoma | Causa probable |
|---|---|
| "el servidor no reconoce esta dirección" | `ALLOWED_ORIGINS` mal escrito: tiene que ser exactamente `https://jorgematiasmaldonado-lab.github.io` |
| "falta registrar al dueño" | No se hizo el paso 6 |
| "el modelo … no existe" | `LLM_MODELO` con un ID que no está en AI Studio |
| "se agotó el cupo gratuito" | Límite de Gemini; esperar o bajar el uso |
| No llega el código por email | Revisar spam; el correo integrado de Supabase permite pocos envíos por hora |
| "Falta configurar la conexión con Supabase" | Faltan las Variables del paso 5 o no corrió *Publicar web* |
| El micrófono no funciona | Permiso del navegador; en iPhone el reconocimiento de voz del navegador es limitado |
| Telegram no responde | ¿Está cargado `TELEGRAM_BOT_TOKEN`? ¿Tocaste **Vincular** después de cargarlo (eso registra el webhook)? |
| "Google no entregó un permiso permanente" | Quitá el acceso de J.A.R.V.I.S. en myaccount.google.com/permissions y volvé a conectar |
| El permiso de Google se pierde cada 7 días | La app de Google quedó en modo *Prueba*: publicala (*En producción*) y volvé a conectar |
| No llegan los avisos | Telegram vinculado y `Actions → Backend` en verde (el paso *Configurar el reloj* tiene que haber corrido) |
