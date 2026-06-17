autoload -Uz compinit
compinit

# Aliases
function fuzzword() {
        gopass show -c $(gopass list --flat | fzf) && gopass sync;
}

function goto() {
        [[ -z $1 ]] && DIR=($HOME/Documents $HOME/Programs) || DIR=$1
        cd $(find $DIR -type d -maxdepth 5 | fzf --preview "ls -lh {}" --tmux)
}

# PS1 mod
get_branch_name() {
    git branch 2> /dev/null | sed -e '/^[^*]/d' -e 's/* \(.*\)/(\1) /'
}

setopt PROMPT_SUBST
PROMPT='%{%F{blue}%}%1~ %{%F{red}%}$(get_branch_name)%{%F{blue}%}‣ %{%F{none}%}'

# Set variables
export PATH="$PATH:$HOME/bin/:$HOME/go/bin"
export EDITOR="vim"

# Mise setup
export MISE_SHELL=zsh
if [ -z "${__MISE_ORIG_PATH:-}" ]; then
  export __MISE_ORIG_PATH="$PATH"
fi
export __MISE_ZSH_PRECMD_RUN=0
export __MISE_ZSH_CHPWD_RAN=0

mise() {
  local command
  command="${1:-}"
  if [ "$#" = 0 ]; then
    command /opt/homebrew/bin/mise
    return
  fi
  shift

  case "$command" in
  deactivate|shell|sh)
    # if argv doesn't contains -h,--help
    if [[ ! " $@ " =~ " --help " ]] && [[ ! " $@ " =~ " -h " ]]; then
      eval "$(command /opt/homebrew/bin/mise "$command" "$@")"
      return $?
    fi
    ;;
  esac
  command /opt/homebrew/bin/mise "$command" "$@"
}

autoload -Uz add-zsh-hook
_mise_hook() {
  eval "$(/opt/homebrew/bin/mise hook-env -s zsh)";
}
_mise_hook_precmd() {
  if [[ "${__MISE_ZSH_CHPWD_RAN:-0}" == "1" ]]; then
    export __MISE_ZSH_CHPWD_RAN=0
    return
  fi
  eval "$(/opt/homebrew/bin/mise hook-env -s zsh --reason precmd)";
}
_mise_hook_chpwd() {
  export __MISE_ZSH_CHPWD_RAN=1
  eval "$(/opt/homebrew/bin/mise hook-env -s zsh --reason chpwd)";
}
add-zsh-hook precmd _mise_hook_precmd
add-zsh-hook chpwd _mise_hook_chpwd

_mise_hook
if [ -z "${_mise_cmd_not_found:-}" ]; then
    _mise_cmd_not_found=1
    [ -n "$(declare -f command_not_found_handler)" ] && eval "${$(declare -f command_not_found_handler)/command_not_found_handler/_command_not_found_handler}"

    function command_not_found_handler() {
        if [[ "$1" != "mise" && "$1" != "mise-"* ]] && /opt/homebrew/bin/mise hook-not-found -s zsh -- "$1"; then
          _mise_hook
          "$@"
        elif [ -n "$(declare -f _command_not_found_handler)" ]; then
            _command_not_found_handler "$@"
        else
            echo "zsh: command not found: $1" >&2
            return 127
        fi
    }
fi

#

# >>> mamba initialize >>>
# !! Contents within this block are managed by 'mamba shell init' !!
export MAMBA_EXE='/opt/homebrew/bin/mamba';
export MAMBA_ROOT_PREFIX='/Users/lam/.local/share/mamba';
__mamba_setup="$("$MAMBA_EXE" shell hook --shell zsh --root-prefix "$MAMBA_ROOT_PREFIX" 2> /dev/null)"
if [ $? -eq 0 ]; then
    eval "$__mamba_setup"
else
    alias mamba="$MAMBA_EXE"  # Fallback on help from mamba activate
fi
unset __mamba_setup
# <<< mamba initialize <<<
eval "$(~/.local/bin/mise activate zsh)"
