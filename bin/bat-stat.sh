#!/bin/sh

# Check battery charge periodically to notify low and full charge
bat_perc=$(cat /sys/class/power_supply/BAT0/capacity)
bat_time=$(acpi -b | cut -d " " -f 5)
status=$(cat /sys/class/power_supply/BAT0/status)

# Check whether display is available
if [ -z $DISPLAY ]; then
	if [ status=="discharging" ]; then
		[ $bat_perc -lt 20 ] &&
			tmux display-message \
			"Plug the device, battery is $bat_perc"
	else	# Notification if battery is charging
		[ $bat_perc -gt 85 ] &&
			tmux display-message \
			"Unplug the device, battery is $bat_perc"
	fi
else 	# If display is available (xorg running)
	if [ status=="discharging" ]; then
		[ $bat_perc -lt 20 ] &&
			notify-send --urgency critical "Plug the device" "$bat_time remaining" &&
			mpg123 ~/.config/i3/ping-notif.mp3
	else	# Notification if battery is charging
		[ $bat_perc -gt 85 ] &&
			notify-send --urgency normal "Unplug the device" "Battery is $bat_perc" &&
			mpg123 ~/.config/i3/ping-notif.mp3
	fi

fi
