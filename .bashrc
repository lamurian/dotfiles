#
# ~/.bashrc
#

# Vim key-binding in bash
set -o vi

# If not running interactively, don't do anything
[[ $- != *i* ]] && return

# Global alias
alias ls='ls --color=auto'
alias yt='newsboat -u $HOME/.newsboat/yt.urls -c $HOME/.newsboat/yt-cache.db'
alias manga='newsboat -u $HOME/.newsboat/manga.urls -c $HOME/.newsboat/manga-cache.db'

# Alias for tty only
if [ -z $DISPLAY ]; then
	alias mpv='mplayer -vo fbdev2'
	alias scrot='fbgrab -i'
else	# Unset alias outside tty
	unalias mplayer 2>/dev/null
	unalias scrot 2>/dev/null
fi

# PS1 mod
PS1='\[\033[1;34m\]── \[\033[0m\] '
#PS1='\033[1;34m\]┌──\033[0m\] \u in \w\n\033[1;34m\]└─\033[0m\] '

# Nifty function
ac() {
	# Change into specified dir
        [ -z $1 ] && cd $(find $ONDR $BLOG -type d | fzf) || \
                cd $(find $1 -type d | fzf)
}

conf() {
	# Open config file using vim
	vim $(find $HOME/.config/* -type f | fzf -m)
}

blog() {
        # Edit blog content
        vim $(find $BLOG -iregex '.*R?md' | fzf -m)
}

force_color_prompt=yes

export ONDR=/mnt/data/OneDrive
export BLOG=/mnt/shared/Documents/blog
export PATH=$PATH:/shims:/home/lam/.local/bin:/home/lam/bin

export LC_ALL=en_US.UTF-8
export LANG=en_US.UTF-8
export LANGUAGE=en_US.UTF-8

export BROWSER=qutebrowser
export EDITOR=vim
export SYSTEMD_EDITOR=vim

export XDG_DATA_HOME=/mnt/data/lamuri
export XDG_CACHE_HOME=/mnt/data/.cache/
export XDG_CONFIG_HOME=$HOME/.config

# Runtime dir and pulse server for flatpak env
export XDG_RUNTIME_DIR=/mnt/data/lamuri/runtime
#export PULSE_SERVER=unix:/tmp/pulse-socket
