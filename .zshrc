autoload -Uz compinit
compinit

# Aliases
function fuzzword() {
        gopass show -c $(gopass list --flat | fzf) && gopass sync;
}

function goto() {
        [[ -z $1 ]] && DIR=$HOME/Documents || DIR=$1
        cd $(find $DIR -type d -maxdepth 5 | fzf --preview "ls -lh {}" --tmux)
}

# PS1 mod
get_branch_name() {
    git branch 2> /dev/null | sed -e '/^[^*]/d' -e 's/* \(.*\)/(\1) /'
}

setopt PROMPT_SUBST
PROMPT='%{%F{blue}%}%1~ %{%F{red}%}$(get_branch_name)%{%F{blue}%}‣ %{%F{none}%}'

# Set path
export PATH="$PATH:$HOME/bin/"

# >>> mamba initialize >>>
# !! Contents within this block are managed by 'mamba init' !!
export MAMBA_EXE='/opt/homebrew/opt/micromamba/bin/micromamba';
export MAMBA_ROOT_PREFIX='/Users/lam/micromamba';
__mamba_setup="$("$MAMBA_EXE" shell hook --shell zsh --root-prefix "$MAMBA_ROOT_PREFIX" 2> /dev/null)"
if [ $? -eq 0 ]; then
    eval "$__mamba_setup"
else
    alias micromamba="$MAMBA_EXE"  # Fallback on help from mamba activate
fi
unset __mamba_setup
# <<< mamba initialize <<<
