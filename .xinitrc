# Function to call wm
call_i3() {
	exec dbus-run-session i3
}

call_bspwm() {
	exec dbus-run-session bspwm
}

call_dwm() {
	feh --bg-fill $HOME/data/personal/Pictures/wallpaper/misty-forest.jpg &
	sxhkd &
	# Require `status` script from t480 branch in dotfiles git
	while true; do xsetroot -name " `status pwr` "; sleep 5s; done &
	exec dbus-run-session dwm
}

call_dwm_mod() {
	feh --bg-fill $HOME/data/personal/Pictures/wallpaper/misty-forest.jpg &
	sxhkd &
	# Require `status` script from t480 branch in dotfiles git
	while true; do xsetroot -name " `status pwr` "; sleep 5s; done &
	exec dbus-run-session /home/lam/data/personal/programs/suckless/dwm/dwm
}

call_min() {
	workspace -i &
	sxhkd -c $XDG_CONFIG_HOME/sxhkd/{sxhkdrc,wmutilshk} &
	termite
}

unclutter -idle 1 -noevents &
song-notif.sh 2>&1 > /dev/null &

# Call the wm
call_dwm
