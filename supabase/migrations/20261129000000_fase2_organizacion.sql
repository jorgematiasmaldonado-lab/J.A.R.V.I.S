-- =====================================================================
-- J.A.R.V.I.S. · Fase 2 · Organización: tareas, proyectos, recordatorios,
-- agenda (Google Calendar), resumen matutino y Telegram
-- Autor: Maldonado Jorge Matias
--
-- Seguridad:
--   * RLS en todas las tablas (dueño + aal2).
--   * La app solo cambia columnas puntuales (permisos POR COLUMNA): nunca
--     puede escribir el chat de Telegram ni el estado de Google, para que
--     un ataque en el navegador no pueda desviar avisos a otro Telegram.
--   * El permiso de Google (refresh token) se guarda cifrado en Vault.
--   * El reloj (pg_cron) revisa dentro de la base y solo llama a la
--     función jarvis-cron cuando hay algo para hacer, con un secreto
--     generado acá (nadie tiene que copiarlo a mano).
-- =====================================================================

-- Así los habilita la documentación de Supabase (pg_cron en pg_catalog; pg_net crea el esquema "net")
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------
-- Proyectos
-- ---------------------------------------------------------------------
create table public.proyectos (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  nombre      text not null check (char_length(nombre) between 2 and 80),
  alias       text[] not null default '{}',
  repo        text check (repo ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  cliente     text check (char_length(cliente) <= 80),
  prioridad   smallint not null default 2 check (prioridad between 1 and 3),   -- 1 alta · 2 normal · 3 baja
  estado      text not null default 'activo' check (estado in ('activo', 'pausado', 'terminado')),
  creado      timestamptz not null default now(),
  actualizado timestamptz not null default now()
);
create unique index proyectos_nombre_unico on public.proyectos (user_id, lower(nombre));
alter table public.proyectos enable row level security;

-- ---------------------------------------------------------------------
-- Tareas
-- ---------------------------------------------------------------------
create table public.tareas (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  titulo      text not null check (char_length(titulo) between 2 and 300),
  notas       text check (char_length(notas) <= 2000),
  proyecto_id bigint references public.proyectos (id) on delete set null,
  vence       date,
  prioridad   smallint not null default 2 check (prioridad between 1 and 3),
  estado      text not null default 'pendiente' check (estado in ('pendiente', 'hecha')),
  completada  timestamptz,
  canal       text check (char_length(canal) <= 20),
  creado      timestamptz not null default now(),
  actualizado timestamptz not null default now()
);
create index tareas_usuario_estado_idx on public.tareas (user_id, estado, vence);
alter table public.tareas enable row level security;

-- ---------------------------------------------------------------------
-- Recordatorios (manuales o generados por eventos del calendario)
-- ---------------------------------------------------------------------
create table public.recordatorios (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references auth.users (id) on delete cascade,
  texto          text not null check (char_length(texto) between 2 and 300),
  cuando         timestamptz not null,
  origen         text not null default 'chat' check (origen in ('chat', 'manual', 'evento')),
  evento_id      text check (char_length(evento_id) <= 200),
  tipo_aviso     text check (tipo_aviso in ('noche', 'hora', 'cuarto', 'inicio')),
  insistir       boolean not null default true,
  limite         timestamptz,                         -- hasta cuándo insistir
  estado         text not null default 'pendiente'
                 check (estado in ('pendiente', 'avisado', 'confirmado', 'cancelado', 'vencido')),
  avisos         integer not null default 0,
  proximo_aviso  timestamptz,
  confirmado     timestamptz,
  canal          text check (char_length(canal) <= 20),
  creado         timestamptz not null default now()
);
create index recordatorios_reloj_idx on public.recordatorios (estado, proximo_aviso);
create index recordatorios_usuario_idx on public.recordatorios (user_id, cuando);
create index recordatorios_evento_idx on public.recordatorios (user_id, evento_id);
alter table public.recordatorios enable row level security;

-- Eventos del calendario que ya tienen avisos programados
create table public.eventos_avisos (
  user_id     uuid not null references auth.users (id) on delete cascade,
  evento_id   text not null check (char_length(evento_id) <= 200),
  titulo      text not null default '',
  inicio      timestamptz not null,
  actualizado timestamptz not null default now(),
  primary key (user_id, evento_id)
);
alter table public.eventos_avisos enable row level security;

-- Resúmenes matutinos (para la pantalla Hoy)
create table public.resumenes (
  id      bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  fecha   date not null,
  texto   text not null check (char_length(texto) <= 6000),
  creado  timestamptz not null default now(),
  unique (user_id, fecha)
);
alter table public.resumenes enable row level security;

-- ---------------------------------------------------------------------
-- Ajustes nuevos
-- ---------------------------------------------------------------------
alter table public.ajustes
  add column telegram_chat_id   bigint,
  add column google_conectado   boolean not null default false,
  add column resumen_activo     boolean not null default true,
  add column resumen_hora       time not null default '07:30',
  add column no_molestar_desde  time not null default '23:00',
  add column no_molestar_hasta  time not null default '07:00',
  add column avisar_eventos     boolean not null default true,
  add column ultimo_resumen     date;

-- ---------------------------------------------------------------------
-- Datos internos (sin políticas: solo el servidor)
-- ---------------------------------------------------------------------
-- Vínculo con Telegram: código de un solo uso generado desde la app
create table public.telegram_vinculos (
  codigo_hash text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  vence       timestamptz not null default now() + interval '15 minutes'
);
alter table public.telegram_vinculos enable row level security;

-- Estado del inicio de sesión con Google (anti-CSRF + PKCE)
create table public.oauth_estados (
  estado_hash text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  verificador text not null,
  vence       timestamptz not null default now() + interval '10 minutes'
);
alter table public.oauth_estados enable row level security;

-- Configuración del reloj y del bot (una sola fila)
create table public.config_privada (
  id                integer primary key default 1 check (id = 1),
  url               text,
  secreto_reloj     text not null default encode(extensions.gen_random_bytes(32), 'hex'),
  secreto_telegram  text not null default encode(extensions.gen_random_bytes(32), 'hex'),
  ultima_sync       timestamptz,
  ultima_llamada    timestamptz
);
alter table public.config_privada enable row level security;
insert into public.config_privada (id) values (1) on conflict do nothing;

-- Lo llama el workflow después de desplegar (necesita la URL del proyecto)
create or replace function public.configurar_reloj(p_url text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.config_privada set url = rtrim(p_url, '/') where id = 1;
$$;
revoke all on function public.configurar_reloj(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Token de Google en Vault (cifrado)
-- ---------------------------------------------------------------------
create or replace function public.guardar_token_google(p_user uuid, p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nombre text := 'google_refresh_' || p_user::text;
  v_id uuid;
begin
  select id into v_id from vault.secrets where name = v_nombre;
  if v_id is null then
    perform vault.create_secret(p_token, v_nombre, 'Permiso de Google Calendar de J.A.R.V.I.S.');
  else
    perform vault.update_secret(v_id, p_token);
  end if;
end;
$$;

create or replace function public.leer_token_google(p_user uuid)
returns text
language sql
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'google_refresh_' || p_user::text;
$$;

create or replace function public.borrar_token_google(p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from vault.secrets where name = 'google_refresh_' || p_user::text;
$$;

revoke all on function public.guardar_token_google(uuid, text) from public, anon, authenticated;
revoke all on function public.leer_token_google(uuid) from public, anon, authenticated;
revoke all on function public.borrar_token_google(uuid) from public, anon, authenticated;
grant execute on function public.guardar_token_google(uuid, text) to service_role;
grant execute on function public.leer_token_google(uuid) to service_role;
grant execute on function public.borrar_token_google(uuid) to service_role;

-- ---------------------------------------------------------------------
-- El reloj: cada minuto revisa si hay algo que hacer
-- ---------------------------------------------------------------------
create or replace function public.hay_trabajo_reloj()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    -- Recordatorios que toca avisar
    exists (select 1 from public.recordatorios r
            where r.estado in ('pendiente', 'avisado') and r.proximo_aviso <= now())
    -- Resumen matutino que toca enviar
    or exists (select 1 from public.ajustes a
               where a.resumen_activo and a.telegram_chat_id is not null
                 and (now() at time zone a.zona_horaria)::time >= a.resumen_hora
                 and (now() at time zone a.zona_horaria)::time < a.resumen_hora + interval '3 hours'
                 and (a.ultimo_resumen is null or a.ultimo_resumen < (now() at time zone a.zona_horaria)::date))
    -- Sincronizar el calendario cada 15 minutos
    or exists (select 1 from public.ajustes a, public.config_privada c
               where a.google_conectado and a.avisar_eventos
                 and (c.ultima_sync is null or c.ultima_sync < now() - interval '15 minutes'));
$$;

create or replace function public.tick_jarvis()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.config_privada;
begin
  select * into c from public.config_privada where id = 1;
  if c.url is null then return; end if;
  if not public.hay_trabajo_reloj() then return; end if;
  -- Evita llamadas encimadas si la anterior sigue trabajando
  if c.ultima_llamada is not null and c.ultima_llamada > now() - interval '50 seconds' then return; end if;
  update public.config_privada set ultima_llamada = now() where id = 1;
  perform net.http_post(
    url := c.url || '/functions/v1/jarvis-cron',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-jarvis-reloj', c.secreto_reloj),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end;
$$;
revoke all on function public.hay_trabajo_reloj() from public, anon, authenticated;
revoke all on function public.tick_jarvis() from public, anon, authenticated;
grant execute on function public.hay_trabajo_reloj() to service_role;

-- Programar (o reprogramar) el reloj cada minuto
select cron.schedule('jarvis-reloj', '* * * * *', 'select public.tick_jarvis()');

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------
revoke all on public.proyectos, public.tareas, public.recordatorios, public.eventos_avisos, public.resumenes,
              public.telegram_vinculos, public.oauth_estados, public.config_privada
  from anon, authenticated;

-- La app: leer todo lo suyo; cambiar solo columnas puntuales
grant select, delete on public.proyectos to authenticated;
grant update (prioridad, estado, actualizado) on public.proyectos to authenticated;
grant select, delete on public.tareas to authenticated;
grant update (estado, completada, actualizado) on public.tareas to authenticated;
grant select on public.recordatorios to authenticated;
grant update (estado, confirmado) on public.recordatorios to authenticated;
grant select on public.resumenes to authenticated;

-- Ajustes: ya no se puede escribir cualquier columna desde la app
revoke insert, update on public.ajustes from authenticated;
grant insert (user_id, nombre_trato, ciudad_base, ciudad_lat, ciudad_lon, zona_horaria, actualizado,
              resumen_activo, resumen_hora, no_molestar_desde, no_molestar_hasta, avisar_eventos)
  on public.ajustes to authenticated;
grant update (nombre_trato, ciudad_base, ciudad_lat, ciudad_lon, zona_horaria, actualizado,
              resumen_activo, resumen_hora, no_molestar_desde, no_molestar_hasta, avisar_eventos)
  on public.ajustes to authenticated;

-- El servidor
grant select, insert, update, delete on public.proyectos, public.tareas, public.recordatorios,
  public.eventos_avisos, public.resumenes, public.telegram_vinculos, public.oauth_estados to service_role;
grant select, update on public.config_privada to service_role;
grant usage, select on all sequences in schema public to service_role;

-- RLS (solo el dueño con aal2)
create policy proyectos_select on public.proyectos for select to authenticated
  using (user_id = (select auth.uid()) and (select public.es_dueno()));
create policy proyectos_update on public.proyectos for update to authenticated
  using (user_id = (select auth.uid()) and (select public.es_dueno()))
  with check (user_id = (select auth.uid()) and (select public.es_dueno()));
create policy proyectos_delete on public.proyectos for delete to authenticated
  using (user_id = (select auth.uid()) and (select public.es_dueno()));

create policy tareas_select on public.tareas for select to authenticated
  using (user_id = (select auth.uid()) and (select public.es_dueno()));
create policy tareas_update on public.tareas for update to authenticated
  using (user_id = (select auth.uid()) and (select public.es_dueno()))
  with check (user_id = (select auth.uid()) and (select public.es_dueno()));
create policy tareas_delete on public.tareas for delete to authenticated
  using (user_id = (select auth.uid()) and (select public.es_dueno()));

create policy recordatorios_select on public.recordatorios for select to authenticated
  using (user_id = (select auth.uid()) and (select public.es_dueno()));
create policy recordatorios_update on public.recordatorios for update to authenticated
  using (user_id = (select auth.uid()) and (select public.es_dueno()))
  with check (user_id = (select auth.uid()) and (select public.es_dueno()) and estado in ('confirmado', 'cancelado'));

create policy resumenes_select on public.resumenes for select to authenticated
  using (user_id = (select auth.uid()) and (select public.es_dueno()));
