!#/bin/bash

# Little script to produce screen cast

TIME=${1}
OUTPUT=${2}

timeout $TIME ffmpeg \
	-f x11grab \
	-video_size 1920x1080 \
	-framerate 20 \
	-i :0.0 \
	$OUTPUT
