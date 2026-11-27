# J.A.R.V.I.S.

Asistente personal con inteligencia artificial, al estilo de Jarvis.
**Autor:** Maldonado Jorge Matias · JMM Gestiones & Tecnología
**Estado:** Fase 0 (seguridad base). Ver [`ESTADO.md`](ESTADO.md) y [`SEGURIDAD.md`](SEGURIDAD.md).

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
  js/ui.js · app.js          interfaz y flujo principal
  manifest.webmanifest · sw.js · icons/ · img/
supabase/
  migrations/                esquema, RLS y funciones SQL
  functions/jarvis-chat/     el cerebro
  functions/_compartido/     seguridad, agente, seudonimización, LLM, herramientas
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

1. Creá el repositorio **público** `jarvis` en GitHub (Pages gratis requiere repo público; el código no tiene secretos).
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
4. **URL Configuration → Site URL**: `https://jorgematiasmaldonado-lab.github.io/jarvis/`
5. **Multi-Factor**: verificá que **TOTP** esté habilitado (viene activado).

### Paso 4 · Secrets de la Edge Function

1. En Google AI Studio creá una **clave nueva** de Gemini. En Google Cloud restringila **solo a Generative Language API**, sin restricción de sitio web (la usa el servidor, no el navegador).
2. En Supabase → **Edge Functions → Secrets**, agregá:

| Nombre | Valor | |
|---|---|---|
| `GEMINI_API_KEY` | la clave nueva | obligatorio |
| `ALLOWED_EMAIL` | tu email | obligatorio |
| `ALLOWED_ORIGINS` | `https://jorgematiasmaldonado-lab.github.io` (sin `/jarvis`, sin barra final) | obligatorio |
| `LLM_MODELO` | `gemini-flash-lite-latest` (o el ID exacto que figure en AI Studio) | opcional |
| `LIMITE_LLM_POR_DIA` | un poco menos que el límite diario gratuito que muestra AI Studio para tu modelo (*Rate limits*) | recomendado |
| `LIMITE_POR_MINUTO` / `LIMITE_POR_DIA` | por defecto 10 y 300 mensajes | opcional |

`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` las pone Supabase sola.

### Paso 5 · GitHub: secrets, variables y despliegue

1. **Supabase → Account (arriba a la derecha) → Access Tokens → Generate new token**, nombre `github-jarvis`.
2. En GitHub → repo → **Settings → Secrets and variables → Actions**:
   - **Secrets:** `SUPABASE_ACCESS_TOKEN` (el token), `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`.
   - **Variables:** `SUPABASE_URL`, `SUPABASE_CLAVE_PUBLICA` (la *publishable*).
3. **Settings → Environments → New environment** `produccion` (opcional: *Required reviewers* = vos, para aprobar cada despliegue).
4. **Actions → Backend → Run workflow**. Corre las pruebas, aplica la base de datos, publica la función y verifica que nada sea público. Todo tiene que quedar en verde.
5. **Actions → Publicar web → Run workflow**. Al terminar, la app queda en `https://jorgematiasmaldonado-lab.github.io/jarvis/`.

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

## Proteger nombres de personas (seudónimos)

Los teléfonos, emails, DNI, CUIL y direcciones se ocultan automáticamente. Los **nombres** se ocultan si están en la tabla `seudonimos`. Hasta que esté la pantalla "Memoria" (Fase 1), se cargan en **SQL Editor**:

```sql
insert into public.seudonimos (user_id, tipo, valor, alias)
select id, 'PERSONA', 'Juan Pérez', array['Pérez', 'Juancito']
from auth.users where email = 'SU_EMAIL_AQUÍ';
```

En la Fase 3 se cargan solos desde la lista de personal y los contactos.

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

**Seguridad:**
- [ ] En *Actions → Backend*, el paso "Verificar que nada sea público" está en verde.
- [ ] `verificar_seguridad.sql` → todo OK.
- [ ] En Supabase → *Table Editor → actividad* aparecen los chats y herramientas, sin el texto de los mensajes.

## Costos (Fase 0)

| Servicio | Plan | Costo |
|---|---|---|
| GitHub (repo + Pages + Actions) | Gratis (repo público) | USD 0 |
| Supabase | Free | USD 0 · los proyectos inactivos se pausan (hoy, tras ~7 días; ver supabase.com/pricing) y se reactivan desde el panel |
| Gemini API | Capa gratuita | USD 0 · con límites por minuto y por día; **Google puede usar los datos de la capa gratuita para mejorar sus productos** (por eso la seudonimización) |
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
