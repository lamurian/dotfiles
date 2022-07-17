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
        [ -z $1 ] && cd $(find $PROF $BUKA $BLOG -type d -not -path "*/.git/*" | fzf) || \
                cd $(find $1 -type d -not -path "*/.git/*" | fzf)
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

export DATA=$HOME/data
export BLOG=$DATA/personal/Documents/blog
export BOOK=$DATA/personal/Documents/ebook
export PROF=$DATA/professional
export WC=$PROF/jobs/writing-center
export MT=$PROF/jobs/medtech
export BUKA=$PROF/jobs/bukalapak
export ACDM=$PROF/Documents/academy
export PHD=$PROF/Documents/academy/_postgrad/PhD-course
export PYENV=$DATA/personal/programs/pyenv # PyEnv root folder
export FLUTTER=$DATA/personal/programs/flutter # Flutter root folder
export SDK=$DATA/personal/programs/android-sdk # Android ANDROID_SDK_ROOT root folder
export PATH=$PATH:/shims:/home/lam/.local/bin:/home/lam/bin:$PYENV/bin:$FLUTTER/bin:$SDK/cmdline-tools/latest/bin:$SDK/emulator:$SDK/platform-tools:$SDK/tools:$SDK/tools/bin

export LC_ALL=en_US.UTF-8
export LANG=en_US.UTF-8
export LANGUAGE=en_US.UTF-8

export BROWSER=qutebrowser
export CHROME_EXECUTABLE=/bin/chromium
export EDITOR=vim
export SYSTEMD_EDITOR=vim

export XDG_DATA_HOME=$DATA/lamuri
export XDG_DATA_DIRS=$XDG_DATA_DIRS:$DATA/lamuri/flatpak/share
export XDG_CACHE_HOME=$DATA/.cache/
export XDG_CONFIG_HOME=$HOME/.config

# Use Kvantum style
export QT_STYLE_OVERRIDE=kvantum

# Runtime dir and pulse server for flatpak env
export XDG_RUNTIME_DIR=$DATA/lamuri/runtime
#export PULSE_SERVER=unix:/tmp/pulse-socket

# Add `pyenv` path
eval "$(pyenv init -)"
