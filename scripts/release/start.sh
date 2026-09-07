#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
unset NODE_PATH NODE_OPTIONS
exec "$root/runtime/bin/node" "$root/launch.mjs" "$@"
