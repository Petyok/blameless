#!/bin/bash
# Publish the built game to https://blameless.petruha.ge (vps-germany): dist/ to the nginx root, the nginx rules
# (deploy/blameless.snippet.conf) and the stats server (server/stats.py as systemd unit blameless-stats on
# 127.0.0.1:8789, proxied at /api/).
# Build first: tools/remote.sh build (or e2e). The vhost (deploy/blameless.petruha.ge.conf) is installed once by
# hand and managed by certbot from then on: see that file.
set -euo pipefail
cd "$(dirname "$0")"
H=vps-germany
[ -f dist/game.js ] && [ -d dist/assets/music ] || { echo "dist/ is not built: tools/remote.sh build" >&2; exit 1; }
python3 -m unittest discover -s server -p 'test_*.py' -q

build=$(mktemp -d)
trap 'rm -rf "$build"' EXIT
cp -r dist/. "$build/"
# nginx serves these via gzip_static; -9 beats its on-the-fly level 1
find "$build" -type f \( -name '*.js' -o -name '*.css' -o -name '*.html' \) -exec gzip -9 -k -f {} \;
rsync -az --delete --chmod=D755,F644 --chown=www-data:www-data "$build/" $H:/var/www/blameless.petruha.ge/

# nginx rules: reload only when they changed, and only if the whole configuration still parses.
# Everything outside the web root belongs to root: rsync -a alone would keep the uploader's uid.
if [ -n "$(rsync -ai --chmod=F644 --chown=root:root deploy/blameless.snippet.conf $H:/etc/nginx/snippets/blameless.conf)" ]; then
  sshub exec $H --timeout 30 -- 'nginx -t && systemctl reload nginx'
fi

# stats server: restart only when the code or the unit changed
changed=$(rsync -ai --chmod=D755,F644 --chown=root:root server/stats.py $H:/opt/blameless-stats/ --rsync-path='mkdir -p /opt/blameless-stats && rsync';
          rsync -ai --chmod=F644 --chown=root:root deploy/blameless-stats.service $H:/etc/systemd/system/)
if [ -n "$changed" ]; then
  sshub exec $H --timeout 30 -- 'systemctl daemon-reload && systemctl enable --now blameless-stats && systemctl restart blameless-stats'
fi

curl -fsS -o /dev/null -w 'page %{http_code}, ' https://blameless.petruha.ge/
curl -fsS -o /dev/null -w 'api %{http_code}\n' https://blameless.petruha.ge/api/board
echo "deployed: https://blameless.petruha.ge"
