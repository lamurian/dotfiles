# Function to call wm
function call_i3 {
	exec i3
}

function call_bspwm {
	exec bspwm
}

function call_dwm {
	feh --bg-fill /mnt/shared/Pictures/wallpaper/02.png &
	exec dwm
}

function call_min {
	workspace -i &
	sxhkd -c $XDG_CONFIG_HOME/sxhkd/{sxhkdrc,wmutilshk} &
	termite
}

# Set background

exec udiskie &
unclutter -idle 1 &

systemctl --user import-environment DISPLAY &

xrdb -merge ~/.Xresources &
date >> bat-stat.txt && sudo tlp-stat -b >> bat-stat.txt &

# Call the wm
call_i3
