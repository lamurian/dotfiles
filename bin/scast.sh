#!/bin/bash

# Little script to produce screen cast

[ -z $1 ] && OUTPUT=$(date +%y%m%d_%H%M%S.mp4) || OUTPUT=${1}
SIZE=$(xrandr -q --current | grep \* | awk '{print $1}' | head -n 1)
SOUND=$(pactl list sources short | awk '{print $2}' | grep mon)

ffmpeg \
        -f pulse -i default \
        -f x11grab \
	-video_size $SIZE \
        -framerate 30 \
        -i :0.0 -c:v libx264 \
	-f mp4 $OUTPUT
