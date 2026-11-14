#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/backend" && npm run build
cd "$ROOT/frontend" && npm run build
cd "$ROOT/ops-mobile" && npm run build
rsync -a --delete "$ROOT/frontend/dist/" /var/www/opticlean/web/
rsync -a --delete "$ROOT/ops-mobile/dist/" /var/www/opticlean/ops/
# Misma bodega visual en web y móvil
rsync -a --delete "$ROOT/frontend/public/control-embed/" /var/www/opticlean/web/control-embed/
rsync -a --delete "$ROOT/frontend/public/control-embed/" /var/www/opticlean/ops/control-embed/
chown -R www-data:www-data /var/www/opticlean
systemctl restart opticlean-api
nginx -t && nginx -s reload
echo "OK · https://opti.innovamf.com  ·  https://ops.innovamf.com"
