-- =====================================================================
-- J.A.R.V.I.S. · Verificación de seguridad de la base
-- Autor: Maldonado Jorge Matias
--
-- Pegar en Supabase → SQL Editor y ejecutar. Todas las filas de
-- resultado deben decir "OK". Si alguna dice "FALLA", no seguir.
-- =====================================================================

-- 1) Toda tabla del esquema public tiene RLS activada
select 'RLS ' || c.relname as chequeo,
       case when c.relrowsecurity then 'OK' else 'FALLA: RLS desactivada' end as resultado
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'

union all

-- 2) El rol anónimo no tiene permisos sobre ninguna tabla
select 'anon sin permisos en ' || table_name,
       'FALLA: anon tiene ' || string_agg(privilege_type, ', ')
from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public'
group by table_name

union all

-- 2b) El servidor (service_role) puede leer la tabla dueno
select 'servidor puede leer dueno',
       case when has_table_privilege('service_role', 'public.dueno', 'SELECT') then 'OK'
            else 'FALLA: falta la migración de permisos del servidor' end

union all

-- 3) Hay exactamente un dueño registrado
select 'un único dueño',
       case (select count(*) from public.dueno)
         when 1 then 'OK'
         when 0 then 'FALLA: falta registrar el dueño (README, paso 4)'
         else 'FALLA: hay más de un dueño'
       end

union all

-- 4) Hay exactamente un usuario en Auth (uso personal)
select 'un único usuario en Auth',
       case (select count(*) from auth.users) when 1 then 'OK' else 'REVISAR: hay ' || (select count(*) from auth.users) || ' usuarios' end;
