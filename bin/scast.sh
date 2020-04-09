#!/bin/bash

# Little script to produce screen cast

[ -z $1 ] && OUTPUT=$(date +%y%m%d_%H%M%S.mkv) || OUTPUT=${1}
SIZE=$(xrandr -q --current | grep \* | awk '{print $1}')
SOUND=$(pactl list sources short | awk '{print $2}' | grep mon)

ffmpeg \
        -f pulse -i default \
        -f x11grab \
	-video_size $SIZE \
        -framerate 25 \
        -i :0.0 \
	-c:v libx264 -c:a aac \
	$OUTPUT
