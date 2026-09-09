#!/usr/bin/env bash
set -euo pipefail

tsc="${1:-${TSC:-}}"
if [[ -z "$tsc" ]]; then
  printf 'usage: %s /path/to/tsc\n' "$0" >&2
  exit 2
fi
here="$(cd "$(dirname "$0")" && pwd)"
pi_root="$(npm root -g)/@earendil-works/pi-coding-agent"
config="$(mktemp "${TMPDIR:-/tmp}/herdr-delegate-tsconfig.XXXXXX.json")"
trap 'rm -f "$config"' EXIT
HERE="$here" PI_ROOT="$pi_root" python3 - "$config" <<'PY'
import json, os, sys
root = os.environ["PI_ROOT"]
json.dump({
  "compilerOptions": {
    "target": "ESNext", "module": "Preserve", "moduleResolution": "bundler",
    "allowImportingTsExtensions": True, "strict": True, "skipLibCheck": True,
    "noFallthroughCasesInSwitch": True, "noUncheckedIndexedAccess": True,
    "exactOptionalPropertyTypes": True, "noImplicitOverride": True,
    "baseUrl": "/", "ignoreDeprecations": "6.0",
    "paths": {
      "@earendil-works/pi-coding-agent": [f"{root}/dist/index.d.ts"],
      "@earendil-works/pi-ai": [f"{root}/node_modules/@earendil-works/pi-ai/dist/index.d.ts"],
      "typebox": [f"{root}/node_modules/typebox/build/index.d.mts"]
    },
    "typeRoots": [f"{root}/node_modules/@types"]
  },
  "include": [f'{os.environ["HERE"]}/*.ts']
}, open(sys.argv[1], "w"))
PY
"$tsc" -p "$config" --noEmit
