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

for tabla in dueno ajustes mensajes actividad seudonimos uso_contadores memorias perfil acciones_pendientes \
             proyectos tareas recordatorios eventos_avisos resumenes telegram_vinculos oauth_estados config_privada; do
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

# jarvis-acciones también rechaza pedidos sin sesión
codigo=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$URL/functions/v1/jarvis-acciones" \
  -H "Origin: https://ejemplo-no-permitido.com" -H "Content-Type: application/json" -d '{"accion":"confirmar","id":"x"}')
if [[ "$codigo" == "401" || "$codigo" == "403" ]]; then
  echo "✓ jarvis-acciones rechaza pedidos sin sesión (HTTP $codigo)"
else
  echo "✗ jarvis-acciones respondió $codigo a un pedido sin sesión"; FALLAS=1
fi

# El reloj y el webhook de Telegram exigen su secreto
for f in jarvis-cron jarvis-telegram; do
  codigo=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$URL/functions/v1/$f" -H "Content-Type: application/json" -d '{}')
  if [[ "$codigo" == "401" ]]; then echo "✓ $f rechaza llamadas sin su secreto (HTTP $codigo)"; else echo "✗ $f respondió $codigo sin secreto"; FALLAS=1; fi
done

# La vuelta de Google con un "state" inventado no hace nada
codigo=$(curl -sS -o /dev/null -w '%{http_code}' "$URL/functions/v1/jarvis-google?code=x&state=inventado")
if [[ "$codigo" == "400" || "$codigo" == "503" ]]; then echo "✓ jarvis-google rechaza un state inventado (HTTP $codigo)"; else echo "✗ jarvis-google respondió $codigo a un state inventado"; FALLAS=1; fi

# Funciones del servidor que nadie de afuera puede ejecutar
for rpc in leer_token_google tick_jarvis hay_trabajo_reloj configurar_reloj; do
  codigo=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$URL/rest/v1/rpc/$rpc" -H "apikey: $CLAVE" -H "Authorization: Bearer $CLAVE" -H "Content-Type: application/json" -d '{}')
  if [[ "$codigo" == "401" || "$codigo" == "403" || "$codigo" == "404" ]]; then echo "✓ $rpc no es ejecutable por anónimos (HTTP $codigo)"; else echo "✗ $rpc respondió $codigo a un anónimo"; FALLAS=1; fi
done

# buscar_memorias es solo del servidor
codigo=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$URL/rest/v1/rpc/buscar_memorias" \
  -H "apikey: $CLAVE" -H "Authorization: Bearer $CLAVE" -H "Content-Type: application/json" \
  -d '{"p_user":"00000000-0000-0000-0000-000000000000","p_embedding":"[0]"}')
if [[ "$codigo" == "401" || "$codigo" == "403" || "$codigo" == "404" ]]; then
  echo "✓ buscar_memorias no es ejecutable por anónimos (HTTP $codigo)"
else
  echo "✗ buscar_memorias respondió $codigo a un anónimo"; FALLAS=1
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
