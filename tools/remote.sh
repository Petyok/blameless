#!/bin/sh
# The laptop holds the source; gpu-serv (/root/blameless) builds, tests and renders audio.
#   remote.sh push               mirror the source tree to gpu-serv (not assets/: see assets-push)
#   remote.sh run CMD...         run a command in /root/blameless
#   remote.sh pull REMOTE LOCAL  fetch one file (3 MiB chunks, sha256-verified)
#   remote.sh build              push, type-check, unit-test, bundle, fetch dist/
#   remote.sh e2e [SCENARIOS]    build, then the browser run in docker behind nginx; fetch e2e/out/
#   remote.sh assets-push        send assets/ (music + voice) there: the e2e run checks the sound
#   remote.sh assets             fetch assets/ after regenerating audio there
set -eu
cd "$(dirname "$0")/.."
R=/root/blameless
SRC="src test e2e tools server deploy index.html style.css serve.mjs package.json package-lock.json tsconfig.json build.mjs"
ssh_() { sshub exec gpu-serv --timeout "${T:-900}" -- "$@"; }

pull() {
  meta=$(ssh_ "stat -c %s $R/$1 && sha256sum $R/$1 | cut -d' ' -f1")
  size=$(echo "$meta" | sed -n 1p); want=$(echo "$meta" | sed -n 2p)
  : > "$2"
  i=0
  while [ $((i * 3145728)) -lt "$size" ]; do
    ssh_ "dd if=$R/$1 bs=3145728 skip=$i count=1 2>/dev/null | base64 -w0" | base64 -d >> "$2"
    i=$((i + 1))
  done
  have=$(sha256sum "$2" | cut -d' ' -f1)
  [ "$want" = "$have" ] || { echo "sha256 mismatch for $1: $want != $have" >&2; exit 1; }
}

case "${1:-}" in
push)
  have=""; for f in $SRC; do [ -e "$f" ] && have="$have $f"; done
  # shellcheck disable=SC2086
  tar czf - --exclude=e2e/out --exclude=__pycache__ $have | base64 -w0 |
    ssh_ "mkdir -p $R/logs && cd $R && rm -rf src test tools server deploy && base64 -d | tar xzf - --no-same-owner && echo pushed" ;;
run) shift; ssh_ "cd $R && $*" ;;
pull) pull "$2" "$3" ;;
build)
  "$0" push
  ssh_ "cd $R && { [ -d node_modules ] && [ node_modules/.stamp -nt package-lock.json ] || { npm ci --no-audit --no-fund && touch node_modules/.stamp; }; } && npm run -s check && npm test -s > logs/test.log 2>&1 && grep -E '^# (pass|fail)' logs/test.log && npm run -s build && tar czf dist-code.tgz -C dist --exclude=assets ."
  pull dist-code.tgz .dist-code.tgz
  mkdir -p dist && tar xzf .dist-code.tgz -C dist && rm -f .dist-code.tgz
  rm -rf dist/assets && cp -r assets dist/assets
  echo "dist updated: $(ls dist | tr '\n' ' ')" ;;
e2e)
  "$0" build
  ssh_ "cd $R && [ -d assets/voice ] || echo 'no assets/ here: the sound check will fail (remote.sh assets-push)'; sh e2e/run.sh '${2:-flow,campaign,net}' > logs/e2e.log 2>&1; echo exit=\$?; grep -v -E '^ ?(Container|Network|Volume) ' logs/e2e.log | tail -90; tar czf e2e-out.tgz -C e2e out"
  pull e2e-out.tgz .e2e-out.tgz
  rm -rf e2e/out && tar xzf .e2e-out.tgz -C e2e && rm -f .e2e-out.tgz
  ls e2e/out | tr '\n' ' ' ;;
assets-push)
  tar cf - assets | base64 -w0 | ssh_ "mkdir -p $R && cd $R && rm -rf assets && base64 -d | tar xf - --no-same-owner && du -sh assets" ;;
assets)
  ssh_ "cd $R && tar cf assets.tar assets"
  pull assets.tar .assets.tar
  rm -rf assets && tar xf .assets.tar && rm -f .assets.tar
  ssh_ "rm -f $R/assets.tar"
  du -sh assets ;;
*) sed -n '2,10p' "$0"; exit 2 ;;
esac
