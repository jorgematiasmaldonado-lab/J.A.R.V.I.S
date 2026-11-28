-- =====================================================================
-- J.A.R.V.I.S. · Fase 1 · Memoria de largo plazo, perfil y confirmaciones
-- Autor: Maldonado Jorge Matias
--
-- - memorias: recuerdos con vector (pgvector) para buscar por significado.
-- - perfil: texto del usuario que Jarvis siempre tiene en cuenta.
-- - acciones_pendientes: acciones sensibles que esperan Confirmar/Cancelar.
-- Seguridad: RLS (solo el dueño con aal2). La app solo LEE y BORRA sus
-- recuerdos; crear y editar pasa por la Edge Function, que valida que no
-- se guarden datos prohibidos y calcula el vector.
-- =====================================================================

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------
-- Recuerdos
-- ---------------------------------------------------------------------
create table public.memorias (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  texto       text not null check (char_length(texto) between 3 and 1000),
  categoria   text not null default 'dato' check (categoria in ('persona', 'proyecto', 'preferencia', 'dato')),
  embedding   extensions.vector(768),
  fuente      text not null default 'chat' check (fuente in ('chat', 'manual')),
  canal       text check (char_length(canal) <= 20),
  creado      timestamptz not null default now(),
  actualizado timestamptz not null default now()
);
create index memorias_usuario_fecha_idx on public.memorias (user_id, creado desc);
create index memorias_embedding_idx on public.memorias using hnsw (embedding extensions.vector_cosine_ops);
alter table public.memorias enable row level security;

-- ---------------------------------------------------------------------
-- Perfil (un texto libre por usuario)
-- ---------------------------------------------------------------------
create table public.perfil (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  texto       text not null default '' check (char_length(texto) <= 2000),
  actualizado timestamptz not null default now()
);
alter table public.perfil enable row level security;

-- ---------------------------------------------------------------------
-- Acciones sensibles pendientes de confirmación
-- ---------------------------------------------------------------------
create table public.acciones_pendientes (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references auth.users (id) on delete cascade,
  tipo      text not null check (char_length(tipo) <= 40),
  resumen   text not null check (char_length(resumen) <= 300),
  detalle   jsonb not null default '[]',   -- lo que se muestra en la tarjeta
  datos     jsonb not null default '{}',   -- lo que se ejecuta al confirmar (fijado al proponer)
  estado    text not null default 'pendiente' check (estado in ('pendiente', 'confirmada', 'cancelada', 'vencida', 'fallida')),
  canal     text check (char_length(canal) <= 20),
  creado    timestamptz not null default now(),
  vence     timestamptz not null default now() + interval '15 minutes',
  resuelto  timestamptz
);
create index acciones_pendientes_usuario_idx on public.acciones_pendientes (user_id, creado desc);
alter table public.acciones_pendientes enable row level security;

-- ---------------------------------------------------------------------
-- Búsqueda por significado (solo el servidor)
-- ---------------------------------------------------------------------
create or replace function public.buscar_memorias(
  p_user      uuid,
  p_embedding extensions.vector(768),
  p_limite    integer default 5,
  p_umbral    double precision default 0.6
)
returns table (id bigint, texto text, categoria text, creado timestamptz, similitud double precision)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.texto, m.categoria, m.creado,
         1 - (m.embedding operator(extensions.<=>) p_embedding) as similitud
  from public.memorias m
  where m.user_id = p_user
    and m.embedding is not null
    and 1 - (m.embedding operator(extensions.<=>) p_embedding) >= p_umbral
  order by m.embedding operator(extensions.<=>) p_embedding
  limit least(greatest(p_limite, 1), 20);
$$;
revoke all on function public.buscar_memorias(uuid, extensions.vector, integer, double precision) from public, anon, authenticated;
grant execute on function public.buscar_memorias(uuid, extensions.vector, integer, double precision) to service_role;

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------
revoke all on public.memorias, public.perfil, public.acciones_pendientes from anon, authenticated;

-- La app: leer y borrar sus recuerdos; leer perfil y acciones pendientes
grant select, delete on public.memorias            to authenticated;
grant select         on public.perfil              to authenticated;
grant select         on public.acciones_pendientes to authenticated;

-- El servidor
grant select, insert, update, delete on public.memorias            to service_role;
grant select, insert, update         on public.perfil              to service_role;
grant select, insert, update         on public.acciones_pendientes to service_role;
grant delete                         on public.mensajes            to service_role;
grant usage, select on all sequences in schema public to service_role;

-- RLS
create policy memorias_select on public.memorias for select to authenticated
  using (user_id = (select auth.uid()) and (select public.es_dueno()));
create policy memorias_delete on public.memorias for delete to authenticated
  using (user_id = (select auth.uid()) and (select public.es_dueno()));
create policy perfil_select on public.perfil for select to authenticated
  using (user_id = (select auth.uid()) and (select public.es_dueno()));
create policy acciones_select on public.acciones_pendientes for select to authenticated
  using (user_id = (select auth.uid()) and (select public.es_dueno()));
