-- =====================================================================
-- J.A.R.V.I.S. · Fase 0 · Esquema base
-- Autor: Maldonado Jorge Matias
--
-- Principios:
--   * RLS activada en TODAS las tablas.
--   * Solo el "dueño" (un único usuario, registrado a mano en la tabla
--     `dueno`) con MFA completo (aal2) puede leer o escribir sus filas.
--   * El rol anónimo no tiene ningún permiso.
--   * Lo que solo debe hacer el servidor (contadores, auditoría) se
--     escribe con la service role desde la Edge Function.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Dueño único de Jarvis
-- ---------------------------------------------------------------------
-- Se carga UNA vez desde el SQL Editor de Supabase (ver README, paso 4).
-- No tiene políticas: nadie la puede leer desde la API.
create table public.dueno (
  user_id uuid primary key references auth.users (id) on delete cascade,
  creado  timestamptz not null default now()
);
alter table public.dueno enable row level security;

-- ¿Quien hace la consulta es el dueño y completó el MFA?
create or replace function public.es_dueno()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.dueno d where d.user_id = (select auth.uid()))
     and coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2';
$$;
revoke all on function public.es_dueno() from public, anon;
grant execute on function public.es_dueno() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Ajustes sincronizados entre dispositivos
-- (la voz, velocidad y tono son por dispositivo y quedan en el equipo)
-- ---------------------------------------------------------------------
create table public.ajustes (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  nombre_trato  text not null default 'señor' check (char_length(nombre_trato) between 1 and 40),
  ciudad_base   text check (char_length(ciudad_base) <= 80),
  ciudad_lat    double precision check (ciudad_lat between -90 and 90),
  ciudad_lon    double precision check (ciudad_lon between -180 and 180),
  zona_horaria  text not null default 'America/Argentina/Cordoba' check (char_length(zona_horaria) <= 64),
  actualizado   timestamptz not null default now()
);
alter table public.ajustes enable row level security;

-- ---------------------------------------------------------------------
-- Mensajes (memoria de corto plazo compartida entre canales)
-- ---------------------------------------------------------------------
create table public.mensajes (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  rol        text not null check (rol in ('user', 'model')),
  contenido  text not null check (char_length(contenido) <= 8000),
  canal      text not null default 'web' check (canal in ('web', 'android', 'telegram')),
  creado     timestamptz not null default now()
);
create index mensajes_usuario_id_idx on public.mensajes (user_id, id desc);
alter table public.mensajes enable row level security;

-- ---------------------------------------------------------------------
-- Registro de actividad (auditoría). Lo escribe solo el servidor.
-- ---------------------------------------------------------------------
create table public.actividad (
  id          bigint generated always as identity primary key,
  user_id     uuid references auth.users (id) on delete cascade, -- null = intento de acceso de un desconocido
  tipo        text not null check (char_length(tipo) <= 40),    -- chat, herramienta, acceso_denegado, limite…
  herramienta text check (char_length(herramienta) <= 60),
  parametros  jsonb,
  resultado   jsonb,
  ok          boolean not null default true,
  canal       text check (char_length(canal) <= 20),
  creado      timestamptz not null default now()
);
create index actividad_usuario_fecha_idx on public.actividad (user_id, creado desc);
alter table public.actividad enable row level security;

-- ---------------------------------------------------------------------
-- Seudónimos: personas, lugares u organizaciones que NUNCA deben llegar
-- con su nombre real al modelo. Se reemplazan por [PERSONA_12], etc.
-- (En la Fase 3 se suma el cifrado por columna y la carga automática
--  desde la lista de personal y los contactos.)
-- ---------------------------------------------------------------------
create table public.seudonimos (
  id       bigint generated always as identity primary key,
  user_id  uuid not null references auth.users (id) on delete cascade,
  tipo     text not null default 'PERSONA' check (tipo in ('PERSONA', 'LUGAR', 'ORG')),
  valor    text not null check (char_length(valor) between 2 and 120),
  alias    text[] not null default '{}',   -- otras formas de nombrarlo: "Pérez", "Juancito"
  creado   timestamptz not null default now(),
  unique (user_id, tipo, valor)
);
alter table public.seudonimos enable row level security;

-- ---------------------------------------------------------------------
-- Contadores de uso (límite por minuto y por día, llamadas al modelo)
-- ---------------------------------------------------------------------
create table public.uso_contadores (
  user_id     uuid not null references auth.users (id) on delete cascade,
  clave       text not null,               -- p. ej. "peticion:min:2026-11-27T13:05", "llm:dia:2026-11-27"
  cuenta      integer not null default 0,
  actualizado timestamptz not null default now(),
  primary key (user_id, clave)
);
alter table public.uso_contadores enable row level security;

-- Suma uso y devuelve si todavía está dentro de los límites.
-- Solo la puede ejecutar el servidor (service_role).
create or replace function public.consumir_cupo(
  p_user       uuid,
  p_tipo       text,
  p_max_minuto integer,
  p_max_dia    integer,
  p_zona       text default 'America/Argentina/Cordoba',
  p_cantidad   integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_min  text := p_tipo || ':min:' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI');
  v_dia  text := p_tipo || ':dia:' || to_char(now() at time zone p_zona, 'YYYY-MM-DD');
  c_min  integer;
  c_dia  integer;
begin
  insert into public.uso_contadores as u (user_id, clave, cuenta)
  values (p_user, v_min, p_cantidad)
  on conflict (user_id, clave) do update set cuenta = u.cuenta + p_cantidad, actualizado = now()
  returning cuenta into c_min;

  insert into public.uso_contadores as u (user_id, clave, cuenta)
  values (p_user, v_dia, p_cantidad)
  on conflict (user_id, clave) do update set cuenta = u.cuenta + p_cantidad, actualizado = now()
  returning cuenta into c_dia;

  -- Limpieza: los contadores por minuto viejos no sirven más
  delete from public.uso_contadores
   where user_id = p_user and clave like '%:min:%' and actualizado < now() - interval '15 minutes';

  return jsonb_build_object(
    'permitido', c_min <= p_max_minuto and c_dia <= p_max_dia,
    'minuto', c_min,
    'dia', c_dia
  );
end;
$$;
revoke all on function public.consumir_cupo(uuid, text, integer, integer, text, integer) from public, anon, authenticated;
grant execute on function public.consumir_cupo(uuid, text, integer, integer, text, integer) to service_role;

-- ---------------------------------------------------------------------
-- Permisos: el rol anónimo no ve nada
-- ---------------------------------------------------------------------
revoke all on public.dueno, public.ajustes, public.mensajes, public.actividad,
              public.seudonimos, public.uso_contadores from anon;
revoke all on public.dueno from authenticated;

-- ---------------------------------------------------------------------
-- Políticas RLS (solo el dueño con aal2, y solo sus filas)
-- ---------------------------------------------------------------------
-- ajustes: leer, crear y modificar
create policy ajustes_select on public.ajustes for select to authenticated
  using (user_id = (select auth.uid()) and (select public.es_dueno()));
create policy ajustes_insert on public.ajustes for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.es_dueno()));
create policy ajustes_update on public.ajustes for update to authenticated
  using (user_id = (select auth.uid()) and (select public.es_dueno()))
  with check (user_id = (select auth.uid()) and (select public.es_dueno()));

-- mensajes: leer y borrar (los crea el servidor)
create policy mensajes_select on public.mensajes for select to authenticated
  using (user_id = (select auth.uid()) and (select public.es_dueno()));
create policy mensajes_delete on public.mensajes for delete to authenticated
  using (user_id = (select auth.uid()) and (select public.es_dueno()));

-- actividad: solo lectura (la escribe el servidor; no se puede borrar desde la app)
create policy actividad_select on public.actividad for select to authenticated
  using (user_id = (select auth.uid()) and (select public.es_dueno()));

-- seudonimos: control total del dueño
create policy seudonimos_select on public.seudonimos for select to authenticated
  using (user_id = (select auth.uid()) and (select public.es_dueno()));
create policy seudonimos_insert on public.seudonimos for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.es_dueno()));
create policy seudonimos_update on public.seudonimos for update to authenticated
  using (user_id = (select auth.uid()) and (select public.es_dueno()))
  with check (user_id = (select auth.uid()) and (select public.es_dueno()));
create policy seudonimos_delete on public.seudonimos for delete to authenticated
  using (user_id = (select auth.uid()) and (select public.es_dueno()));

-- uso_contadores: solo lectura (para mostrar el consumo del día)
create policy uso_select on public.uso_contadores for select to authenticated
  using (user_id = (select auth.uid()) and (select public.es_dueno()));

-- Permisos de tabla para el rol autenticado (la RLS filtra igual)
revoke all on public.ajustes, public.mensajes, public.actividad, public.seudonimos, public.uso_contadores from authenticated;
grant select, insert, update          on public.ajustes        to authenticated;
grant select, delete                  on public.mensajes       to authenticated;
grant select                          on public.actividad      to authenticated;
grant select, insert, update, delete  on public.seudonimos     to authenticated;
grant select                          on public.uso_contadores to authenticated;
