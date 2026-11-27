#!/usr/bin/env bash
# =====================================================================
# J.A.R.V.I.S. · Buscador de secretos
# Autor: Maldonado Jorge Matias
#
# Falla (código 1) si encuentra algo con forma de clave en los archivos
# del repositorio. Lo corre GitHub Actions en cada push, y se puede
# instalar como hook local para que bloquee el commit:
#     cp scripts/buscar-secretos.sh .git/hooks/pre-commit
# Sin dependencias: solo bash, git y grep.
# =====================================================================
set -euo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# Patrón|Descripción
PATRONES=(
  'AIza[0-9A-Za-z_-]{35}|Clave de Google / Gemini'
  'sb_secret_[0-9A-Za-z_-]{20,}|Clave secreta de Supabase'
  'sbp_[0-9a-f]{40}|Token de acceso personal de Supabase'
  'eyJ[0-9A-Za-z_-]{10,}\.eyJ[0-9A-Za-z_-]*(c2VydmljZV9yb2xl|NlcnZpY2Vfcm9s|zZXJ2aWNlX3JvbG)[0-9A-Za-z_-]*\.[0-9A-Za-z_-]+|JWT con rol service_role'
  '[0-9]{8,10}:AA[0-9A-Za-z_-]{33}|Token de bot de Telegram'
  'gh[pousr]_[0-9A-Za-z]{36,}|Token de GitHub'
  'github_pat_[0-9A-Za-z_]{40,}|Token fine-grained de GitHub'
  '-----BEGIN [A-Z ]*PRIVATE KEY-----|Clave privada'
  'AGE-SECRET-KEY-1[0-9A-Z]{50,}|Clave privada de age'
  'pv_[0-9A-Za-z+/=]{20,}|Posible AccessKey de Picovoice'
  'sk-ant-[0-9A-Za-z_-]{20,}|Clave de la API de Anthropic'
  'postgres(ql)?://[^:@/[:space:]]+:[^@/[:space:]]{6,}@|Cadena de conexión con contraseña'
)

# Archivos versionados (o todos, si todavía no hay repo git)
if git rev-parse --git-dir >/dev/null 2>&1; then
  mapfile -t ARCHIVOS < <(git ls-files --cached --others --exclude-standard)
else
  mapfile -t ARCHIVOS < <(find . -type f -not -path './.git/*')
fi

ENCONTRADO=0
for entrada in "${PATRONES[@]}"; do
  patron="${entrada%|*}"   # la descripción va después del ÚLTIMO "|"
  desc="${entrada##*|}"
  for f in "${ARCHIVOS[@]}"; do
    [[ -f "$f" ]] || continue
    # Este mismo script contiene los patrones: se excluye
    [[ "$f" == "scripts/buscar-secretos.sh" ]] && continue
    case "$f" in *.png|*.jpg|*.jpeg|*.webp|*.ico) continue ;; esac
    if grep -nE -- "$patron" "$f" >/dev/null 2>&1; then
      linea=$(grep -nE -- "$patron" "$f" | head -1 | cut -d: -f1)
      echo "✗ ${desc}: ${f}:${linea}"
      ENCONTRADO=1
    fi
  done
done

# Archivos que nunca deben subirse
for f in "${ARCHIVOS[@]}"; do
  case "$f" in
    .env|*.env|.env.*|*.pem|*.key|*.p12|*.jks|*.keystore|supabase/.temp/*|*service-account*.json)
      [[ "$f" == ".env.ejemplo" ]] && continue
      echo "✗ Archivo sensible versionado: $f"; ENCONTRADO=1 ;;
  esac
done

if [[ $ENCONTRADO -eq 1 ]]; then
  echo ""
  echo "Se encontraron posibles secretos. NO los suba: muévalos a los secrets de Supabase o de GitHub."
  echo "Si una clave real llegó a subirse alguna vez, considérela comprometida y rótela."
  exit 1
fi
echo "✓ Sin secretos a la vista (${#ARCHIVOS[@]} archivos revisados)."
