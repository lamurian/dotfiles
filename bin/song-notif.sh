#!/bin/sh

#start-pulseaudio-x11 &&
mpd &&
form="<span color='##666666'><b>Artist</b></span>\
	<span color='##065f73'>%artist%</span>\
	\n<span color='##666666'><b>Album</b></span>\
	<span color='##666666'>%album%</span>\
	\n<span color='##666666'><b>Title</b></span>\
	<span color='##c5c8c6'>%title%</span>"

while true
do
    mpc idle player > /dev/null

    toprint="`mpc current -f \"$form\" | sed \"s:&:&amp;:g\"`"
    echo $toprint > /dev/null

    dunstify -a MPD -r 1337 -t 2000 -i "                   MPD" "$toprint"
done
