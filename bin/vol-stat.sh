#!/bin/sh

# Notify volume changes with dunstify

vol=$(pulsemixer --get-volume | awk '{print $1}')

# Decide whether the volume is muted or not
amixer get Master | tail -n 1 | grep off 2>&1 > /dev/null && \
	icon="<span foreground='#666666'></span>" || \
	icon=""

md1o="<span foreground='#999999'><b>"	# Open tag for markdown formatting
md1c="</b></span>"			# Close tag for markdown formatting
md2o="<span foreground='#000000'>"
md2c="</span>"

# Make volume slider
case $vol in
	0)
		level="$md2o────────────────────$md2c"
		;;
	[1-9])
		level="$md1o──$md1c$md2o──────────────────$md2c"
		;;
	1[0-9])
		level="$md1o────$md1c$md2o────────────────$md2c"
		;;
	2[0-9])
		level="$md1o──────$md1c$md2o──────────────$md2c"
		;;
	3[0-9])
		level="$md1o────────$md1c$md2o────────────$md2c"
		;;
	4[0-9])
		level="$md1o──────────$md1c$md2o──────────$md2c"
		;;
	5[0-9])
		level="$md1o────────────$md1c$md2o────────$md2c"
		;;
	6[0-9])
		level="$md1o──────────────$md1c$md2o──────$md2c"
		;;
	7[0-9])
		level="$md1o────────────────$md1c$md2o────$md2c"
		;;
	8[0-9])
		level="$md1o──────────────────$md1c$md2o──$md2c"
		;;
	*)
		level="$md1o────────────────────$md1c"
		;;
esac

#notify-send -u low -t 800 " " "$icon $vol% $level"
dunstify -r 1 -u low -t 800 "Volume" \
"<span font='Font Awesome 10'>$icon</span> \
<span font='Inconsolata 10'>$vol</span> \
<span font='Font Awesome 5'>$level</span>"
