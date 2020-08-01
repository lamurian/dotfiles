<<<<<<< HEAD
# Function to calculate wattage consumption
watt() {
        echo - | awk "{printf \"%.1f\", \
        $(( \
          $(cat /sys/class/power_supply/BAT0/current_now) * \
          $(cat /sys/class/power_supply/BAT0/voltage_now) \
        )) / 1000000000000 }" ; echo " W "
}

=======
>>>>>>> d2b3ef88559eea853bdf0a75a863f1b1a69222b3
# Function to call wm
call_i3() {
	exec i3
}

call_bspwm() {
	exec bspwm
}

call_dwm() {
	feh --bg-fill $ONDR/Pictures/wallpaper/misty-forest.jpg &
	sxhkd &
<<<<<<< HEAD
        while true; do xsetroot -name " `watt` "; sleep 5s; done &
=======
	# Requrie `status` script from t480 branch in dotfiles git
	while true; do xsetroot -name " `status pwr` "; sleep 5s; done &
>>>>>>> d2b3ef88559eea853bdf0a75a863f1b1a69222b3
	exec dwm
}

call_min() {
	workspace -i &
	sxhkd -c $XDG_CONFIG_HOME/sxhkd/{sxhkdrc,wmutilshk} &
	termite
}

unclutter -idle 1 &
song-notif.sh 2>&1 > /dev/null &

# Call the wm
call_dwm
