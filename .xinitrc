# Function to call wm
function call_i3 {
	polybar bar &
	exec i3
}

function call_dwm {
	exec dwm
}

function call_bspwm {
	sxhkd &
	polybar bar &
	exec bspwm
}

# Set background
feh --bg-fill /mnt/data/lamuri/Pictures/wallpaper/02.png &

exec udiskie &
unclutter -idle 1 &

systemctl --user import-environment DISPLAY &

compton 2>&1 &
xrdb -merge ~/.Xresources &
#start-pulseaudio-x11 &
date >> bat-stat.txt && sudo tlp-stat -b >> bat-stat.txt &

source ~/.bashrc &

# Call the wm
call_i3
