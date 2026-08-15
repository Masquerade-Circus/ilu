#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
tools_bin="$repo_root/.tmp/tools/bin"
capture_home="$repo_root/.tmp/capture/home"
capture_cache="$repo_root/.tmp/capture/cache"
capture_tmp="$repo_root/.tmp/v"
capture_marker="$repo_root/.tmp/capture/capture-start"

if [[ ! -x "$tools_bin/vhs" || ! -x "$tools_bin/ttyd" ]]; then
  printf '%s\n' "Local VHS and ttyd binaries are required under .tmp/tools/bin." >&2
  exit 1
fi

cd "$repo_root"
mkdir -p "$capture_cache" "$capture_tmp"
node docs/demos/seed-terminal-demo.mjs
touch "$capture_marker"
HOME="$capture_home" XDG_CACHE_HOME="$capture_cache" TMPDIR="$capture_tmp" PATH="$tools_bin:$PATH" VHS_NO_SANDBOX=true "$tools_bin/vhs" docs/demos/ilu-board.tape
if [[ ! ".tmp/capture/intermediate/ilu-board.webm" -nt "$capture_marker" ]]; then
  printf '%s\n' "VHS did not produce a fresh Board capture." >&2
  exit 1
fi
ffmpeg -y -ss 0.4 -i ".tmp/capture/intermediate/ilu-board.webm" -frames:v 1 "docs/assets/ilu-board.png" -loglevel error
node docs/demos/seed-terminal-demo.mjs
touch "$capture_marker"
HOME="$capture_home" XDG_CACHE_HOME="$capture_cache" TMPDIR="$capture_tmp" PATH="$tools_bin:$PATH" VHS_NO_SANDBOX=true "$tools_bin/vhs" docs/demos/ilu-workflow.tape
if [[ ! "docs/assets/ilu-workflow.gif" -nt "$capture_marker" || ! "docs/assets/ilu-workflow.webm" -nt "$capture_marker" ]]; then
  printf '%s\n' "VHS did not produce fresh workflow captures." >&2
  exit 1
fi
