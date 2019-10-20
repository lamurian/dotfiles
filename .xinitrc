watt () {
	echo - | awk "{printf \"%.1f\", \
	$(( \
	  $(cat /sys/class/power_supply/BAT0/power_now) \
	)) / 1000000 }" ; echo " W "
}

unclutter -idle 1 &

xrdb -merge ~/.Xresources &

feh --bg-fill /mnt/shared/Pictures/wallpaper/min-fox-forest.jpg &

# Custom keybinding
sxhkd &

# Calculate wattage consumption
while true; do xsetroot -name " `watt` "; sleep 5s; done &

# Call the wm
exec dwm
