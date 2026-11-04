#!/usr/bin/env bash
# Reads the tunnel address from ~/fsh/tunnel.log and writes it into the page config.
set -euo pipefail
cd "$(dirname "$0")/.."
url=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' ~/fsh/tunnel.log | tail -1)
[ -n "$url" ] || { echo "no tunnel address in ~/fsh/tunnel.log"; exit 1; }
sed -i "s#api: '.*'#api: '$url'#" web/config.js
git add web/config.js
git diff --cached --quiet || git commit -qm "chore: point the page at the current tunnel"
echo "$url"
