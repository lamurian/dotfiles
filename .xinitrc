# Function to call wm
call_i3() {
	exec i3
}

call_bspwm() {
	exec bspwm
}

call_dwm() {
	feh --bg-fill $HOME/data/private/Pictures/wallpaper/misty-forest.jpg &
	sxhkd &
	# Require `status` script from t480 branch in dotfiles git
	while true; do xsetroot -name " `status pwr` "; sleep 5s; done &
	exec dwm
}

call_dwm_mod() {
	feh --bg-fill $HOME/data/private/Pictures/wallpaper/misty-forest.jpg &
	sxhkd &
	# Require `status` script from t480 branch in dotfiles git
	while true; do xsetroot -name " `status pwr` "; sleep 5s; done &
	exec /home/lam/data/private/programs/suckless/dwm/dwm
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
