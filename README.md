# Dotfiles

Personal dotfiles, organised by OS and role to support different machines.

## Structure

```
common/   Shared configs (bin scripts, shell tools, app settings)
darwin/   macOS-specific (.zshrc, .zprofile)
linux/    Linux-specific (.bashrc, .Xresources, .xinitrc)
work/     Work machine extras (.tmux.conf, .vimrc, pandoc templates)
```

Each directory is a GNU Stow package that gets symlinked into `$HOME`.

## Bootstrap

The bootstrap script uses [GNU Stow](https://www.gnu.org/software/stow/) to
symlink the right packages into your home directory.

```bash
# Common + auto-detected OS (darwin or linux) + work profile
./bootstrap.sh

# Common + OS + work profile (explicit)
./bootstrap.sh work

# Explicit packages
./bootstrap.sh darwin work

# Pull your existing ~/ configs into the repo (then review with git, commit)
./bootstrap.sh --adopt

# Remove the symlinks again
./bootstrap.sh --undo
```

`--adopt` and `--undo` are mutually exclusive.

To add a new machine, create a directory at the repo root (e.g. `personal/`),
put its stow-compatible tree inside, whitelist the paths in `.gitignore`,
then pass the package name to `bootstrap.sh`.

## Included tools

`common/bin/` contains helper scripts for notifications (volume, brightness,
media), colour utilities, session management, and more.

`common/.config/` houses settings for qutebrowser (with a Tinted Theming
submodule), neovim, ncmpcpp, newsboat, and other terminal applications.

!["Desktop"](https://images-wixmp-ed30a86b8c4ca887773594c2.wixmp.com/f/aca28a1b-1468-4d82-ab27-7cd5b0e4e1b2/ddh5bah-60587df9-8e50-4cf0-a85e-07957d9382f3.png?token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1cm46YXBwOjdlMGQxODg5ODIyNjQzNzNhNWYwZDQxNWVhMGQyNmUwIiwiaXNzIjoidXJuOmFwcDo3ZTBkMTg4OTgyMjY0MzczYTVmMGQ0MTVlYTBkMjZlMCIsIm9iaiI6W1t7InBhdGgiOiJcL2ZcL2FjYTI4YTFiLTE0NjgtNGQ4Mi1hYjI3LTdjZDViMGU0ZTFiMlwvZGRoNWJhaC02MDU4N2RmOS04ZTUwLTRjZjAtYTg1ZS0wNzk1N2Q5MzgyZjMucG5nIn1dXSwiYXVkIjpbInVybjpzZXJ2aWNlOmZpbGUuZG93bmxvYWQiXX0.EZP2SWqFyrpRX0tJRy2IZgxEVoKbiuIRjrylgAVUdl8)
