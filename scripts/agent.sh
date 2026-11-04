#!/usr/bin/env bash
# Restarts the agent. `scripts/agent.sh dry` buys nothing. `scripts/agent.sh live` buys for real. Run by the founder only.
set -euo pipefail
cd "$(dirname "$0")/.."
mode=${1:?say dry or live}
pkill -f 'src/main\.mjs' || true
sleep 1
if [ "$mode" = live ]; then export SHAGUN_LIVE=1; fi
nohup node --disable-warning=ExperimentalWarning --env-file=../shagun.env src/main.mjs >> ~/fsh/agent.log 2>&1 < /dev/null &
sleep 4
tail -2 ~/fsh/agent.log
curl -s localhost:8791/health; echo
