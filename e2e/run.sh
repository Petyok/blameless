#!/bin/sh
# E2E on gpu-serv: one compose project (nginx with the production rules, the stats server, the browser),
# containers and network removed afterwards. The npm cache volume stays for reruns; cleanup removes it.
#   sh e2e/run.sh [flow,campaign,net]
set -u
cd "$(dirname "$0")/.."
C="docker compose -p blameless-e2e -f e2e/compose.yaml"
mkdir -p e2e/out && rm -f e2e/out/*
code=0
# the server's own rules, under the production python
$C run --rm stats python3 -m unittest discover -s /app -p 'test_*.py' || code=$?
[ $code -eq 0 ] && { SCENARIOS="${1:-flow,campaign,net}" $C run --rm test || code=$?; }
[ $code -eq 0 ] || { echo "--- nginx"; $C logs --tail 30 web; echo "--- stats"; $C logs --tail 30 stats; }
$C down --remove-orphans
exit $code
