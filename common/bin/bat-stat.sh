#!/bin/sh

# Check battery charge periodically to notify low and full charge
bat_perc=$(cat /sys/class/power_supply/BAT0/capacity)
bat_time=$(acpi -b | cut -d " " -f 5)
stat=$(cat /sys/class/power_supply/BAT0/status)

if [ $stat = "Discharging" ]; then
	[ $bat_perc -lt 20 ] \
	&& notify-send --urgency critical "Plug the device" "$bat_time remaining" \
	&& mpg123 ~/.config/i3/ping-notif.mp3
else
	[ $bat_perc -gt 85 ] \
	&& notify-send --urgency normal "Unplug the device" "Battery is $bat_perc" \
	&& mpg123 ~/.config/i3/ping-notif.mp3
fi
