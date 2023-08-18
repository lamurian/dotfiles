#!/bin/bash

# Little script to produce screen cast

[ -z $1 ] && OUTPUT=$DATA/personal/Videos/_recording/$(date +%y%m%d_%H%M%S.mp4) || OUTPUT=${1}
MIC=$(pactl list sources short | awk '{print $2}' | grep input) # Record audio input (mic), same as `default`
SIZE=$(xrandr -q --current | grep \* | awk '{print $1}' | head -n 1)
SOUND=$(pactl list sources short | awk '{print $2}' | grep mon) # Record audio output from the desktop

ffmpeg \
        -f pulse -ac 2 -ar 48000 -i $MIC \
        -f x11grab -show_region 1 -video_size $SIZE -framerate 30 -i :0.0 \
        -vcodec libx265 -crf 24 \
        -acodec libmp3lame -ar 48000 -q:a 1 \
	-vsync 1 -f mp4 $OUTPUT
