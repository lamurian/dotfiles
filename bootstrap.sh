#!/usr/bin/env bash
# Bootstrap dotfiles via stow.
#
# Usage:
#   ./bootstrap.sh              # common + detected OS (darwin|linux)
#   ./bootstrap.sh work         # common + detected OS + work
#   ./bootstrap.sh darwin work  # common + darwin + work (explicit)
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"

packages=(common)

if [ $# -eq 0 ]; then
  packages+=("$OS")
else
  packages+=("$@")
fi

for pkg in "${packages[@]}"; do
  echo "stow $pkg"
  command stow -d "$DIR" -t "$HOME" "$pkg"
done
