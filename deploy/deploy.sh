#!/usr/bin/env bash
set -euo pipefail

HOST="${DEPLOY_HOST:?укажите DEPLOY_HOST=user@ip}"
KEY="${DEPLOY_KEY:-$HOME/.ssh/id_ed25519}"
TARGET="${DEPLOY_PATH:-/opt/funnel-runtime}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "→ синхронизирую исходники в $HOST:$TARGET"
rsync -az --delete \
  --exclude node_modules --exclude dist --exclude data --exclude .git \
  --exclude '*.tsbuildinfo' --exclude .DS_Store \
  -e "ssh -i $KEY" \
  "$ROOT/" "$HOST:$TARGET/"

echo "→ собираю и перезапускаю"
ssh -i "$KEY" "$HOST" "set -e
  cd $TARGET
  npm ci --no-progress --no-audit --no-fund
  npm run build
  chown -R funnel:funnel $TARGET
  systemctl restart funnel-runtime
  sleep 2
  systemctl is-active funnel-runtime
  curl -sf http://127.0.0.1:3000/api/health"

echo
echo "→ готово"
