#!/bin/sh

# Send notification when changing backlight level

lglevel=$(xbacklight -get | cut -d '.' -f 1)
icon=""

md1o="<span foreground='#999999'><b>"	# Open tag for markdown formatting
md1c="</b></span>"			# Close tag for markdown formatting
md2o="<span foreground='#000000'>"
md2c="</span>"

case $lglevel in
	[0-4])
		stat="$md2o--------------------$md2c"
		;;
	[5-9])
		stat="$md1o-$md1c$md2o-------------------$md2c"
		;;
	1[0-4])
		stat="$md1o--$md1c$md2o------------------$md2c"
		;;
	1[5-9])
		stat="$md1o---$md1c$md2o-----------------$md2c"
		;;
	2[0-4])
		stat="$md1o----$md1c$md2o----------------$md2c"
		;;
	2[5-9])
		stat="$md1o-----$md1c$md2o---------------$md2c"
		;;
	3[0-4])
		stat="$md1o------$md1c$md2o--------------$md2c"
		;;
	3[5-9])
		stat="$md1o-------$md1c$md2o-------------$md2c"
		;;
	4[0-4])
		stat="$md1o--------$md1c$md2o------------$md2c"
		;;
	4[5-9])
		stat="$md1o---------$md1c$md2o-----------$md2c"
		;;
	5[0-4])
		stat="$md1o----------$md1c$md2o----------$md2c"
		;;
	5[5-9])
		stat="$md1o-----------$md1c$md2o---------$md2c"
		;;
	6[0-4])
		stat="$md1o------------$md1c$md2o--------$md2c"
		;;
	6[5-9])
		stat="$md1o-------------$md1c$md2o-------$md2c"
		;;
	7[0-4])
		stat="$md1o--------------$md1c$md2o------$md2c"
		;;
	7[5-9])
		stat="$md1o---------------$md1c$md2o-----$md2c"
		;;
	8[0-4])
		stat="$md1o----------------$md1c$md2o----$md2c"
		;;
	8[5-9])
		stat="$md1o-----------------$md1c$md2o---$md2c"
		;;
	9[0-4])
		stat="$md1o------------------$md1c$md2o--$md2c"
		;;
	9[5-9])
		stat="$md1o-------------------$md1c$md20-$md2c"
		;;
	*)
		stat="$md1o--------------------$md1c"
		;;
esac

dunstify -r 1 -u low "Backlight" \
"<span font='Font Awesome 8'>$icon</span> \
<span font='Inconsolata 10'>$lglevel $stat</span>"
