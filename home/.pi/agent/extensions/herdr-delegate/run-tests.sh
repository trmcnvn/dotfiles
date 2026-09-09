#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
pi_root="$(npm root -g)/@earendil-works/pi-coding-agent"
run_dir="$(mktemp -d "${TMPDIR:-/tmp}/herdr-delegate-tests.XXXXXX")"
trap 'rm -rf "$run_dir"' EXIT

mkdir -p "$run_dir/node_modules/@earendil-works"
cp "$here/delegation.ts" "$here/index.ts" "$here/delegation.test.ts" "$here/entrypoints.test.ts" "$here/reporter.test.ts" "$here/fake-herdr.mjs" "$run_dir/"
ln -s "$pi_root" "$run_dir/node_modules/@earendil-works/pi-coding-agent"
ln -s "$pi_root/node_modules/@earendil-works/pi-ai" "$run_dir/node_modules/@earendil-works/pi-ai"
ln -s "$pi_root/node_modules/typebox" "$run_dir/node_modules/typebox"

cd "$run_dir"
node --test delegation.test.ts entrypoints.test.ts reporter.test.ts
