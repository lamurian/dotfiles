# Function to calculate wattage consumption
watt() {
	echo - | awk "{printf \"%.1f\", \
	$(( \
	  $(cat /sys/class/power_supply/BAT0/power_now) \
	)) / 1000000 }" ; echo " W "
}

# Function to call wm
call_i3() {
	exec i3
}

call_bspwm() {
	exec bspwm
}

call_dwm() {
	feh --bg-fill /mnt/shared/Pictures/wallpaper/min-fox-forest.jpg &
	sxhkd &
	while true; do xsetroot -name " `watt` "; sleep 5s; done &
	exec dwm
}

call_min() {
	workspace -i &
	sxhkd -c $XDG_CONFIG_HOME/sxhkd/{sxhkdrc,wmutilshk} &
	termite
}

# Set background process
unclutter -idle 1 &

xrdb -merge ~/.Xresources &
# Call the wm
call_dwm
