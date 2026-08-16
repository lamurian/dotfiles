#!/usr/bin/env bash
# ============================================================================
# test-sandbox.sh — unit tests for scripts/sandbox.sh
#
# Feeds synthetic PreToolUse payloads (the same JSON goose writes to a hook's
# stdin) into the hook script and asserts the expected verdict:
#   * block -> stdout contains {"decision":"block",...}
#   * allow -> stdout is empty (exit 0)
#
# Usage:
#   scripts/test-sandbox.sh [path-to-sandbox.sh]
#
# Override the repo whose .gitignore is tested with:
#   REPO=/path/to/repo scripts/test-sandbox.sh
#
# Exit code is 0 when every test passes, 1 otherwise.
# ============================================================================

set -u

HOOK="${1:-$(dirname "$0")/sandbox.sh}"
# default: the git top-level of the plugin's repo (dotfiles)
REPO="${REPO:-$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)}"

for bin in jq bash; do
  command -v "$bin" >/dev/null 2>&1 || { echo "test-sandbox: '$bin' not found" >&2; exit 1; }
done

pass=0; fail=0

# run <desc> <tool_name> <tool_input-json> <expect: block|allow>
run() {
  local desc="$1" tool="$2" input="$3" expect="$4" payload out rc
  payload="$(jq -nc --arg t "$tool" --argjson i "$input" --arg w "$REPO" \
    '{event:"PreToolUse",tool_name:$t,tool_input:$i,working_dir:$w}')"
  out="$(printf '%s' "$payload" | bash "$HOOK" 2>&1)"
  rc=$?
  if [ "$expect" = "block" ] && printf '%s' "$out" | grep -q '"decision":"block"'; then
    pass=$((pass+1)); echo "PASS [block] $desc -> $(printf '%s' "$out" | jq -r .reason)"
  elif [ "$expect" = "allow" ] && [ -z "$out" ] && [ "$rc" -eq 0 ]; then
    pass=$((pass+1)); echo "PASS [allow] $desc"
  else
    fail=$((fail+1)); echo "FAIL [$expect] $desc (rc=$rc): $out"
  fi
}

# ---- expected blocks --------------------------------------------------------
run "write .env"                    developer__write      '{"path":".env","content":"x"}' block
run "shell: cat .env"               developer__shell      '{"command":"cat .env"}' block
run "shell: git add .env"           developer__shell      '{"command":"git add .env"}' block
run "shell: cp .env /tmp"           developer__shell      '{"command":"cp .env /tmp"}' block
run "shell: cat \".env\" (quoted)"  developer__shell      '{"command":"cat \".env\""}' block
run "shell: cp abs .env out"        developer__shell      "{\"command\":\"cp $REPO/.env /tmp\"}" block
run "write .config/chromium/x"      developer__write      '{"path":".config/chromium/x","content":""}' block
run "shell: echo > .local/foo"      developer__shell      '{"command":"echo hi > .local/foo"}' block
run "write R/script.R"              developer__write      '{"path":"R/script.R","content":""}' block
run "write .vim/plugged/foo"        developer__write      '{"path":".vim/plugged/foo","content":""}' block
run "tree .local"                   developer__tree       '{"path":".local"}' block
run "read_image source .env"        developer__read_image '{"source":".env"}' block

# ---- expected allows (whitelisted / not governed) ---------------------------
run "write README.md"               developer__write      '{"path":"README.md","content":""}' allow
run "write .bashrc"                 developer__write      '{"path":".bashrc","content":""}' allow
run "edit .zshrc"                   developer__edit       '{"path":".zshrc","before":"a","after":"b"}' allow
run "edit .vim/view/x (whitelisted)" developer__edit      '{"path":".vim/view/x","before":"a","after":"b"}' allow
run "tree .config/i3"               developer__tree       '{"path":".config/i3"}' allow
run "write .newsboat/urls"          developer__write      '{"path":".newsboat/urls","content":""}' allow
run "write bin/tool.sh"             developer__write      '{"path":"bin/tool.sh","content":""}' allow
run "read_image .vimrc"             developer__read_image '{"source":".vimrc"}' allow
run "tree . (repo root)"            developer__tree       '{"path":"."}' allow
run "shell: rg TODO"                developer__shell      '{"command":"rg TODO"}' allow
run "shell: make"                   developer__shell      '{"command":"make"}' allow
run "shell: cat /etc/passwd (out)"  developer__shell      '{"command":"cat /etc/passwd"}' allow
run "write ../outside/x"            developer__write      '{"path":"../outside/x","content":""}' allow
run "tool without path"             todo__todo_write      '{"content":"x"}' allow

echo
echo "results: $pass passed, $fail failed (repo: $REPO, hook: $HOOK)"
[ "$fail" -eq 0 ]
