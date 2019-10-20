#
# ~/.bashrc
#

# Vim key-binding in bash
set -o vi

# If not running interactively, don't do anything
[[ $- != *i* ]] && return

# Global alias
alias ls='ls --color=auto'

# Alias for tty only
if [ -z $DISPLAY ]; then
	alias mplayer='mplayer -vo fbdev2'
	alias scrot='fbgrab -i'
else	# Unset alias outside tty
	unalias mplayer 2>/dev/null
	unalias scrot 2>/dev/null
fi

# PS1 mod
PS1='\[\033[1;34m\] ——\[\033[0m\] '
#PS1='\033[1;34m\]┌──\033[0m\] \u in \w\n\033[1;34m\]└─\033[0m\] '

# Nifty function
ac() {
	# Open markdown stored in OneDrive using vim
	cd $(find $ONDR -type d | fzf)
}

conf() {
	# Open config file using vim
	vim $(find $HOME/.config/* -type f | fzf -m)
}

force_color_prompt=yes

export ONDR=/mnt/data/OneDrive
export PATH=$PATH:$(pyenv root)/shims:/home/lam/.local/bin:/home/lam/bin:/home/lam/bin/wmscripts
export LC_ALL=en_US.UTF-8
export LANG=en_US.UTF-8
export LANGUAGE=en_US.UTF-8
export EDITOR=vim
export SYSTEMD_EDITOR=vim
export XDG_DATA_HOME=/mnt/data/lamuri
export XDG_CACHE_HOME=/mnt/data/.cache/
export XDG_CONFIG_HOME=$HOME/.config

# ALWAYS put it last (according to the documentation)
eval "$(pyenv init -)"
