polybar bar &
feh --bg-fill /mnt/data/lamuri/Pictures/wallpaper/02.png &

exec udiskie &
unclutter -idle 1 &

systemctl --user import-environment DISPLAY &
#dunst >> /dev/null 2>&1 &

compton 2>&1 &

#[[ -f ~/.Xresources ]] && xrdb -merge ~/.Xresources &
xrdb -merge ~/.Xresources &
start-pulseaudio-x11 &
date >> bat-stat.txt && sudo tlp-stat -b >> bat-stat.txt &

source ~/.bashrc &

exec i3 -V >> ~/.config/i3/start.log 
