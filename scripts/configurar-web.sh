#!/usr/bin/env bash
# =====================================================================
# J.A.R.V.I.S. · Completa la configuración pública de la web
# Autor: Maldonado Jorge Matias
#
# Lo usa el workflow de GitHub Pages. Reemplaza los marcadores de
# web/ con las Variables del repositorio y se NIEGA a publicar si la
# clave parece secreta (service_role o sb_secret_).
#
# Variables de entorno: SUPABASE_URL, SUPABASE_CLAVE_PUBLICA, VERSION
# =====================================================================
set -euo pipefail

URL="${SUPABASE_URL:-}"
CLAVE="${SUPABASE_CLAVE_PUBLICA:-}"
VERSION="${VERSION:-$(date -u +%Y%m%d%H%M)}"

falla() { echo "✗ $1"; exit 1; }

[[ -n "$URL" ]]   || falla "Falta la Variable SUPABASE_URL (Settings → Secrets and variables → Actions → Variables)."
[[ -n "$CLAVE" ]] || falla "Falta la Variable SUPABASE_CLAVE_PUBLICA."

URL="${URL%/}"
[[ "$URL" =~ ^https://[a-z0-9]{10,40}\.supabase\.co$ ]] || falla "SUPABASE_URL debe tener la forma https://<proyecto>.supabase.co"

# La clave tiene que ser PUBLICABLE
if [[ "$CLAVE" == sb_secret_* ]]; then
  falla "SUPABASE_CLAVE_PUBLICA es una clave SECRETA (sb_secret_…). Use la clave publicable (sb_publishable_…). Y rote la secreta: quedó expuesta en las Variables."
elif [[ "$CLAVE" == sb_publishable_* ]]; then
  :
elif [[ "$CLAVE" =~ ^eyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+$ ]]; then
  # Clave "anon" del sistema anterior (JWT): verificar el rol
  carga="${BASH_REMATCH[1]}"
  relleno=$(( (4 - ${#carga} % 4) % 4 ))
  carga="${carga}$(printf '=%.0s' $(seq 1 $relleno) 2>/dev/null || true)"
  rol=$(echo "$carga" | tr '_-' '/+' | base64 -d 2>/dev/null | grep -o '"role":"[a-z_]*"' || true)
  [[ "$rol" == '"role":"anon"' ]] || falla "La clave JWT no es de rol anon (${rol:-desconocido}). Nunca publique la service_role."
else
  falla "SUPABASE_CLAVE_PUBLICA no tiene un formato reconocido."
fi

cd "$(dirname "$0")/../web"
for f in index.html js/config.js sw.js; do
  sed -i \
    -e "s#__SUPABASE_URL__#${URL}#g" \
    -e "s#__SUPABASE_CLAVE_PUBLICA__#${CLAVE}#g" \
    -e "s#__VERSION__#${VERSION}#g" \
    "$f"
done

if grep -rq "__SUPABASE_\|__VERSION__" index.html js/config.js sw.js; then
  falla "Quedaron marcadores sin reemplazar."
fi
echo "✓ Web configurada para ${URL} (versión ${VERSION})."
