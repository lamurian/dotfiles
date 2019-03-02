exec udiskie &
feh --bg-fill /mnt/data/lamuri/Pictures/wallpaper/02.png &
unclutter -idle 1 &
dunst &
compton &
[[ -f ~/.Xresources ]] && xrdb -merge ~/.Xresources &
start-pulseaudio-x11 &
date >> bat-stat.txt && sudo tlp-stat -b >> bat-stat.txt &
exec i3 -V >> ~/.config/i3/start.log 
