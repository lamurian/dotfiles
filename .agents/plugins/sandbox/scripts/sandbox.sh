#!/usr/bin/env bash
# ============================================================================
# sandbox.sh — goose PreToolUse hook (plugin: sandbox)
#
# Runs BEFORE every tool call. It extracts the file/dir path(s) the tool is
# about to touch and blocks the call when a path is blacklisted by the
# .gitignore found in the session working directory (or the nearest .gitignore
# found above it, git-style).
#
# Blacklist / whitelist semantics follow gitignore rules:
#   * every non-comment line is a pattern; "#..." lines are comments
#   * a leading "!" makes a pattern a WHITELIST (negation)
#   * the LAST matching pattern wins
#   * a pattern with no "/" matches any path component (basename)
#   * a leading "/" (or a "/" anywhere) anchors the pattern to the .gitignore
#     directory
#   * a trailing "/" matches directories only (and everything below them)
#   * "**" crosses directory boundaries, "?" matches one non-"/" char
#   * a blocked directory blocks everything under it (negations cannot
#     re-include a path whose parent is blocked)
#
# If no .gitignore is found, nothing is blacklisted and every call is allowed.
#
# This hook FAILS OPEN: any error (missing jq/realpath, invalid JSON, a tool
# without a path argument, a path outside the repo, ...) logs a warning to
# stderr and allows the tool call, matching goose's documented hook behavior.
# ============================================================================

set -u   # note: deliberately no `set -e`; this hook must fail open

# ---- parse the event payload (JSON on stdin) --------------------------------
payload="$(cat 2>/dev/null || true)"

for bin in jq realpath; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "sandbox hook: '$bin' not found on PATH; skipping check (fail open)" >&2
    exit 0
  fi
done

tool="$(printf '%s' "$payload" | jq -r '.tool_name // empty' 2>/dev/null)"
working_dir="$(printf '%s' "$payload" | jq -r '.working_dir // empty' 2>/dev/null)"
tool_input="$(printf '%s' "$payload" | jq -c '.tool_input // {}' 2>/dev/null)"

[ -n "$working_dir" ] || working_dir="$PWD"
working_dir="$(realpath -m -- "$working_dir" 2>/dev/null || printf '%s' "$PWD")"

# ---- locate the .gitignore (CWD first, then walk up, git-style) -------------
gitignore=""
dir="$working_dir"
while :; do
  if [ -f "$dir/.gitignore" ]; then gitignore="$dir/.gitignore"; break; fi
  parent="$(dirname -- "$dir")"
  [ "$parent" = "$dir" ] && break
  dir="$parent"
done
[ -n "$gitignore" ] || exit 0          # no .gitignore -> nothing blacklisted
root="$(dirname -- "$gitignore")"

# ---- extract candidate paths from the tool input ----------------------------
# Known path-bearing keys: developer tools use `path` / `command` / `source`;
# the `uri` key is checked only for file:// URIs. Everything else (content,
# before/after, prd, ...) is ignored.
extract_candidates() {
  printf '%s' "$tool_input" | jq -r '
    to_entries[] | .key as $k | .value as $v |
    if   $k == "path"    then $v
    elif $k == "command" then ($v | split(" ") | .[])
    elif $k == "source"  and (($v | startswith("http://")) | not)
                         and (($v | startswith("https://")) | not) then $v
    elif $k == "uri"     and ($v | startswith("file://")) then ($v | sub("^file://"; ""))
    else empty end
  ' 2>/dev/null || true
}

# ---- clean one candidate token (quotes + shell metacharacters) --------------
clean_token() {
  local t="$1"
  t="${t#\"}"; t="${t%\"}"
  t="${t#\'}"; t="${t%\'}"
  # strip leading shell metacharacters
  while :; do
    case "${t:0:1}" in
      "("|";"|"|"|"&"|">"|"<"|"'"|'"'|'`'|"$") t="${t#?}" ;;
      *) break ;;
    esac
  done
  # strip trailing shell metacharacters / punctuation
  while :; do
    case "${t: -1}" in
      ")"|";"|"|"|"&"|">"|"<"|"'"|'"'|'`'|",") t="${t%?}" ;;
      *) break ;;
    esac
  done
  printf '%s' "$t"
}

# ---- path-like token filter (for `command` strings) -------------------------
# Shell parsing is inherently heuristic: we accept a token when it contains a
# "/", starts with "." (e.g. .env), or starts with "~". Flags, numbers, and
# bare words are ignored, so `make`, `rg TODO`, `git status` are all allowed.
looks_like_path() {
  case "$1" in
    "" | "." | ".." | -* | [0-9]*) return 1 ;;
    */* | .* | ~*) return 0 ;;
    *) return 1 ;;
  esac
}

# ---- turn a candidate into a path relative to the .gitignore root -----------
# Returns 1 (skip) when the path is outside the repo — such paths are not
# governed by this .gitignore, so they are allowed.
to_rel() {
  local cand="$1"
  case "$cand" in
    "~/"*) cand="$HOME${cand#"~"}" ;;
    "~"*)  cand="$HOME${cand#"~"}" ;;
  esac
  case "$cand" in
    /*) : ;;
    *) cand="$working_dir/$cand" ;;
  esac
  cand="$(realpath -m -- "$cand" 2>/dev/null)" || return 1
  case "$cand" in
    "$root"/*) printf '%s' "${cand#"$root"/}" ;;
    "$root")   printf '%s' "." ;;
    *) return 1 ;;                     # outside the repo -> allow
  esac
}

# ---- convert a gitignore glob into an ERE fragment --------------------------
glob_to_regex() {
  local g="$1" out="" c len i=0
  len="${#g}"
  while [ "$i" -lt "$len" ]; do
    c="${g:i:1}"
    case "$c" in
      '*')
        if [ "${g:i:2}" = "**" ]; then
          if [ "${g:i+2:1}" = "/" ]; then
            out+='(/.*)?'              # "**/" in the middle: zero or more dirs
            i=$((i+3))
          else
            out+='.*'
            i=$((i+2))
          fi
        else
          out+='[^/]*'
          i=$((i+1))
        fi
        ;;
      '?') out+='[^/]'; i=$((i+1)) ;;
      '[')
        local j=$((i+1)) cls='[' closed=0
        if [ "${g:j:1}" = "!" ]; then cls+='^'; j=$((j+1)); fi
        while [ "$j" -lt "$len" ]; do
          local ch="${g:j:1}"
          cls+="$ch"; j=$((j+1))
          if [ "$ch" = "]" ]; then closed=1; break; fi
        done
        if [ "$closed" -eq 1 ]; then out+="$cls"; i="$j"; else out+='\[ \]'; i="$len"; fi
        ;;
      '.') out+='\.'; i=$((i+1)) ;;
      '+') out+='\+'; i=$((i+1)) ;;
      '(') out+='\('; i=$((i+1)) ;;
      ')') out+='\)'; i=$((i+1)) ;;
      '{') out+='\{'; i=$((i+1)) ;;
      '}') out+='\}'; i=$((i+1)) ;;
      '^') out+='\^'; i=$((i+1)) ;;
      '$') out+='\$'; i=$((i+1)) ;;
      '|') out+='\|'; i=$((i+1)) ;;
      '\\') out+='\\\\'; i=$((i+1)) ;;
      *) out+="$c"; i=$((i+1)) ;;
    esac
  done
  printf '%s' "$out"
}

# ---- does a single pattern match a path? ------------------------------------
# dir_only patterns require the path itself to be a directory (checked by the
# caller for the full candidate; ancestors are always directories).
match_pattern() {
  local pat="$1" path="$2" dir_only="$3" anchored=0 re=""
  case "$pat" in "**/"*) pat="${pat#\*\*/}" ;; esac   # "**/foo" == "foo"
  case "$pat" in
    /*) anchored=1; pat="${pat#/}" ;;
    */*) anchored=1 ;;
  esac
  re="$(glob_to_regex "$pat")"
  if [ "$anchored" -eq 1 ]; then
    if [ "$dir_only" -eq 1 ]; then
      [[ "$path" =~ ^$re(/|$) ]] && return 0
    else
      [[ "$path" =~ ^$re(/.*)?$ ]] && return 0
    fi
  else
    if [ "$dir_only" -eq 1 ]; then
      [[ "$path" =~ (^|/)$re(/|$) ]] && return 0
    else
      [[ "$path" =~ (^|/)$re(/.*)?$ ]] && return 0
    fi
  fi
  return 1
}

# ---- evaluate every pattern line against one path (last match wins) ---------
# Sets globals VERDICT ("allow"/"block") and BLOCK_PAT (pattern that blocked).
eval_path() {
  local rel="$1" abs="$2" is_anc="$3"
  local line pat neg=0 dir_only=0
  VERDICT="allow"; BLOCK_PAT=""
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%"${line##*[![:space:]]}"}"          # rstrip spaces/tabs
    [ -n "$line" ] || continue
    case "$line" in
      "#"*) continue ;;
      "\\#"*) line="${line#\\}" ;;                   # escaped leading "#"
    esac
    neg=0; pat="$line"
    case "$pat" in
      "\\!"*) pat="${pat#\\}" ;;                     # escaped leading "!"
      "!"*)   neg=1; pat="${pat#!}" ;;
    esac
    pat="${pat%"${pat##*[![:space:]]}"}"
    [ -n "$pat" ] || continue
    dir_only=0
    case "$pat" in */) dir_only=1; pat="${pat%/}" ;; esac
    [ -n "$pat" ] || continue
    if [ "$dir_only" -eq 1 ] && [ "$is_anc" -eq 0 ]; then
      [ -d "$abs" ] || continue                     # dir-only: must be a dir
    fi
    if match_pattern "$pat" "$rel" "$dir_only"; then
      if [ "$neg" -eq 1 ]; then
        VERDICT="allow"
      else
        VERDICT="block"; BLOCK_PAT="$pat"
      fi
    fi
  done < "$gitignore"
}

# ---- verdict for a candidate: block if it or any parent dir is blocked ------
# Returns 0 (block) / 1 (allow). Runs eval_path in the current shell so
# VERDICT/BLOCK_PAT survive for the caller.
verdict_for() {
  local rel="$1" abs="$2" cur="" i
  local -a ancestors=()
  cur="$rel"
  while :; do
    case "$cur" in */*) ;; *) break ;; esac
    cur="${cur%/*}"
    ancestors+=("$cur")
  done
  for i in "${!ancestors[@]}"; do
    eval_path "${ancestors[$i]}" "" 1
    [ "$VERDICT" = "block" ] && return 0
  done
  eval_path "$rel" "$abs" 0
  [ "$VERDICT" = "block" ] && return 0
  return 1
}

# ---- emit a block decision (goose reads it from stdout) ---------------------
block() {
  local path="$1" pat="${BLOCK_PAT:-?}"
  local reason
  reason="$(jq -n --arg p "$path" --arg pat "$pat" --arg g "$gitignore" \
    '"sandbox hook: path \($p) matches blacklisted pattern \($pat) from \($g); tool call blocked."')"
  printf '{"decision":"block","reason":%s}\n' "$reason"
  exit 0
}

# ---- main -------------------------------------------------------------------
while IFS= read -r cand; do
  [ -n "$cand" ] || continue
  cand="$(clean_token "$cand")"
  looks_like_path "$cand" || continue
  rel="$(to_rel "$cand")" || continue
  [ "$rel" = "." ] && continue                     # the repo root itself
  abs="$root/$rel"
  if verdict_for "$rel" "$abs"; then
    block "$cand"
  fi
done < <(extract_candidates)

exit 0   # allowed: print nothing, exit 0
