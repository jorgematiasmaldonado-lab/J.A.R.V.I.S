-- =====================================================================
-- J.A.R.V.I.S. · Permisos explícitos para el servidor (service_role)
-- Autor: Maldonado Jorge Matias
--
-- Los proyectos nuevos de Supabase ya no dan permisos automáticos sobre
-- las tablas nuevas. La Edge Function usa el rol service_role (que salta
-- la RLS, pero igual necesita permisos de tabla) para:
--   - comprobar que el usuario es el dueño (dueno)
--   - leer ajustes, seudónimos e historial
--   - guardar mensajes, auditoría y contadores de uso
-- Sin esto, la función respondía "falta registrar al dueño" aunque el
-- dueño estuviera registrado.
-- =====================================================================

grant usage on schema public to service_role;

grant select                          on public.dueno          to service_role;
grant select, insert, update          on public.ajustes        to service_role;
grant select, insert, delete          on public.mensajes       to service_role;
grant select, insert                  on public.actividad      to service_role;
grant select                          on public.seudonimos     to service_role;
grant select, insert, update, delete  on public.uso_contadores to service_role;

-- Las columnas "identity" usan secuencias internas
grant usage, select on all sequences in schema public to service_role;

-- Las funciones (por si el proyecto tampoco las concedió)
grant execute on function public.es_dueno() to service_role;
grant execute on function public.consumir_cupo(uuid, text, integer, integer, text, integer) to service_role;
