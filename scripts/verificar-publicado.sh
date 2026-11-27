#!/usr/bin/env bash
# =====================================================================
# J.A.R.V.I.S. · Prueba de seguridad sobre el proyecto publicado
# Autor: Maldonado Jorge Matias
#
# Con la clave PUBLICABLE (la que tiene cualquiera que abra la web)
# intenta leer cada tabla y llamar a la función sin sesión.
# Todo debe fallar o devolver vacío. Si algo devuelve datos, falla.
#
# Variables de entorno: SUPABASE_URL, SUPABASE_CLAVE_PUBLICA
# =====================================================================
set -euo pipefail
URL="${SUPABASE_URL%/}"
CLAVE="${SUPABASE_CLAVE_PUBLICA}"
FALLAS=0

for tabla in dueno ajustes mensajes actividad seudonimos uso_contadores; do
  cuerpo=$(curl -sS -w '\n%{http_code}' "$URL/rest/v1/$tabla?select=*&limit=1" -H "apikey: $CLAVE" -H "Authorization: Bearer $CLAVE")
  codigo=$(echo "$cuerpo" | tail -1)
  datos=$(echo "$cuerpo" | sed '$d')
  if [[ "$codigo" == "200" && "$datos" != "[]" ]]; then
    echo "✗ La tabla '$tabla' devolvió datos sin iniciar sesión"; FALLAS=1
  else
    echo "✓ $tabla: protegida (HTTP $codigo)"
  fi
done

# La función sin sesión debe responder 401 (o 403 si el origen no está permitido)
respuesta=$(curl -sS -w '\n%{http_code}' -X POST "$URL/functions/v1/jarvis-chat" \
  -H "Origin: https://ejemplo-no-permitido.com" -H "Content-Type: application/json" -d '{"mensaje":"hola"}')
codigo=$(echo "$respuesta" | tail -1)
cuerpo=$(echo "$respuesta" | sed '$d' | head -c 300)
if [[ "$codigo" == "401" || "$codigo" == "403" ]]; then
  echo "✓ jarvis-chat rechaza pedidos sin sesión (HTTP $codigo)"
elif [[ "$cuerpo" == *configuracion_incompleta* ]]; then
  echo "✗ jarvis-chat: falta cargar un secret de la función (Supabase → Edge Functions → Secrets)."
  echo "  El nombre exacto figura en Supabase → Edge Functions → jarvis-chat → Logs."
  FALLAS=1
else
  echo "✗ jarvis-chat respondió $codigo a un pedido sin sesión: $cuerpo"; FALLAS=1
fi

# Funciones internas: el rol anónimo no puede ejecutarlas
codigo=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$URL/rest/v1/rpc/consumir_cupo" \
  -H "apikey: $CLAVE" -H "Authorization: Bearer $CLAVE" -H "Content-Type: application/json" \
  -d '{"p_user":"00000000-0000-0000-0000-000000000000","p_tipo":"x","p_max_minuto":1,"p_max_dia":1}')
if [[ "$codigo" == "401" || "$codigo" == "403" || "$codigo" == "404" ]]; then
  echo "✓ consumir_cupo no es ejecutable por anónimos (HTTP $codigo)"
else
  echo "✗ consumir_cupo respondió $codigo a un anónimo"; FALLAS=1
fi

exit $FALLAS
