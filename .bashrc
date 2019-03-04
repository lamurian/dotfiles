#
# ~/.bashrc
#

set -o vi

# If not running interactively, don't do anything
[[ $- != *i* ]] && return

alias ls='ls --color=auto'
#PS1='\[\033[1;34m\]--\[\033[0m\] '
PS1='\[\033[1;34m\] ——\[\033[0m\] '

force_color_prompt=yes

export ONDR=/mnt/data/OneDrive
export PATH=$PATH:/home/lam/.local/bin:/home/lam/bin
export XDG_CACHE_HOME=/mnt/data/.cache/
export LC_ALL=en_US.UTF-8
export LANG=en_US.UTF-8
export LANGUAGE=en_US.UTF-8
export EDITOR=vim

# Change TTY console color
if [ "$TERM" = "linux" ]; then
    echo -en "\e]P01d1f21" #black
    echo -en "\e]P82B2B2B" #darkgrey
    echo -en "\e]P1D75F5F" #darkred
    echo -en "\e]P9E33636" #red
    echo -en "\e]P287AF5F" #darkgreen
    echo -en "\e]PA98E34D" #green
    echo -en "\e]P3D7AF87" #brown
    echo -en "\e]PBFFD75F" #yellow
    echo -en "\e]P48787AF" #darkblue
    echo -en "\e]PC7373C9" #blue
    echo -en "\e]P5BD53A5" #darkmagenta
    echo -en "\e]PDD633B2" #magenta
    echo -en "\e]P65FAFAF" #darkcyan
    echo -en "\e]PE44C9C9" #cyan
    echo -en "\e]P7E5E5E5" #lightgrey
    echo -en "\e]PFc5c8c6" #white
    clear #for background artifacting
fi
