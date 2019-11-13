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
	# Requrie `status` script from t480 branch in dotfiles git
	while true; do xsetroot -name " `status pwr` "; sleep 5s; done &
	exec dwm
}

call_min() {
	workspace -i &
	sxhkd -c $XDG_CONFIG_HOME/sxhkd/{sxhkdrc,wmutilshk} &
	termite
}

# Set background

#exec udiskie &
unclutter -idle 1 &

systemctl --user import-environment DISPLAY &

xrdb -merge ~/.Xresources &
#date >> bat-stat.txt && sudo tlp-stat -b >> bat-stat.txt &

# Call the wm
call_dwm
