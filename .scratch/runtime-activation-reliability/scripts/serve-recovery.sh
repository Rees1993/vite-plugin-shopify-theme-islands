#!/bin/sh
set -eu
repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
fixture_dir=$(mktemp -d "${TMPDIR:-/tmp}/islands-recovery.XXXXXX")
trap 'rm -rf "$fixture_dir"' EXIT HUP INT TERM
bun build "$repo_root/src/runtime.ts" --outfile "$fixture_dir/runtime.js" --format esm --target browser
cp "$repo_root/.scratch/runtime-activation-reliability/checks/native-recovery.html" "$fixture_dir/index.html"
printf 'Open http://127.0.0.1:%s/ to run the native recovery matrix.\n' "${PORT:-8766}"
python3 -m http.server "${PORT:-8766}" --bind 127.0.0.1 --directory "$fixture_dir"
