#!/usr/bin/env bash
# Bootstrap dotfiles via stow.
#
# Usage:
#   ./bootstrap.sh                # common + OS (darwin|linux) + work
#   ./bootstrap.sh work           # common + detected OS + work
#   ./bootstrap.sh darwin work    # common + darwin + work (explicit)
#   ./bootstrap.sh --adopt        # pull existing files in ~/ into the repo
#   ./bootstrap.sh --undo         # unstow the default/listed packages
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"

adopt=false
undo=false
packages=()

usage() {
  echo "usage: $0 [--adopt|--undo] [pkg ...]" >&2
  echo "       (no packages defaults to common + OS + work)" >&2
  exit 1
}

for arg in "$@"; do
  case "$arg" in
    --adopt) adopt=true ;;
    --undo)  undo=true ;;
    -*)      echo "$0: unknown option: $arg" >&2; usage ;;
    *)       packages+=("$arg") ;;
  esac
done

if $adopt && $undo; then
  echo "$0: --adopt and --undo are mutually exclusive" >&2
  exit 1
fi

if [ ${#packages[@]} -eq 0 ]; then
  packages=("common" "$OS" "work")
else
  packages=("common" "${packages[@]}")
fi

stow_args=(-d "$DIR" -t "$HOME")
if $adopt; then stow_args+=(--adopt); fi
if $undo;  then stow_args+=(-D); fi

for pkg in "${packages[@]}"; do
  if $undo; then
    echo "unstow $pkg"
  else
    echo "stow $pkg"
  fi
  command stow "${stow_args[@]}" "$pkg"
done

if $adopt; then
  echo "adopted files were moved into the repo; review and commit: git status"
fi
