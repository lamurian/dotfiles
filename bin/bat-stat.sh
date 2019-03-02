#!/bin/sh

# Check battery charge periodically to notify low and full charge
bat_perc=$(acpi -b | cut -d , -f 2 | cut -f 1 -d %)
bat_time=$(acpi -b | cut -d " " -f 5)

if acpi -b | grep Charging > /dev/null; then
	if [ $bat_perc -gt 90 ]; then
		notify-send --urgency normal "Unplug the device" "Fully charged" \
			&& mpg123 ~/.config/i3/ping-notif.mp3
	fi
else
	if [ $bat_perc -lt 20 ]; then
		notify-send --urgency critical "Plug the device" "$bat_time remaining" \
			&& mpg123 ~/.config/i3/ping-notif.mp3
	fi
fi
