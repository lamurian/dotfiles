#!/bin/sh

artist=$(mpc current | cut -d - -f 1)
title=$(mpc current | cut -d - -f 2)

#notify-send -u low "Artist: $artist" "Title: $title"
dunstify -r 1 -u low -t 800 \
	"<span font='Inconsolata 10'><b>Artist: $artist</b></span>" \
	"<span font='Inconsolata 10'>Title: $title</span>"
