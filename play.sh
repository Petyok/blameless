#!/bin/sh
# BLAMELESS: serve dist/ on localhost and open it in a browser app window.
#   ./play.sh            play (Brave or Chromium, own throwaway profile, fullscreen)
#   ./play.sh --serve    only serve; open the printed URL yourself
# PORT picks the port (default 4173); BROWSER_FLAGS adds flags to the browser command.
# The game needs http (the music analyser is muted on file://) and WebGL2.
set -eu
cd "$(dirname "$0")"
PORT="${PORT:-4173}"
[ -f dist/game.js ] || { echo "dist/ is missing: run tools/remote.sh build && tools/remote.sh assets" >&2; exit 1; }
node serve.mjs "$PORT" &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT INT TERM
sleep 0.5
kill -0 $SERVER 2>/dev/null || { echo "could not serve on port $PORT (in use?). Try PORT=4180 ./play.sh" >&2; exit 1; }
URL="http://127.0.0.1:$PORT/"
if [ "${1:-}" = "--serve" ]; then wait $SERVER; exit 0; fi
for b in brave chromium google-chrome-stable google-chrome; do
  if command -v "$b" >/dev/null 2>&1; then
    # own profile: no extensions, no session restore, nothing touches the everyday browser
    # shellcheck disable=SC2086
    "$b" --app="$URL" --user-data-dir="${XDG_CACHE_HOME:-$HOME/.cache}/blameless-browser" --start-fullscreen \
      --ignore-gpu-blocklist --no-first-run --no-default-browser-check ${BROWSER_FLAGS:-} >/dev/null 2>&1
    exit 0
  fi
done
echo "No Chromium-family browser found. Open $URL in any browser with WebGL2; Ctrl+C here when done."
wait $SERVER
