#!/bin/sh
# Script to change all config settings

termite="$HOME/.config/termite"
i3="$HOME/.config/i3"
col="$HOME/.config/color"

### Generate temp.color for multiple purposes

cat $col/termite.col-$1 | head -n 7 | tail -n 4 > $col/temp.color
cat $col/termite.col-$1 | grep color | tail -n 16 >> $col/temp.color

### Generate i3-temp.color file for i3
# awk is used to delete several contained patterns
# sed is intended to substitute multiple patterns
# the syntax can be used interchangeably of course

awk '!/color1|color2|color3|color4|color6|foreground_bold|cursor/' \
	$col/temp.color > $col/i3-temp.color && \

sed "s/foreground/\
	$(cat $col/i3-temp.color | grep for | cut -d "=" -f 2)/" \
	$col/i3.color > $col/i3-1.tmp

sed "s/background/\
	$(cat $col/i3-temp.color | grep bac | cut -d "=" -f 2)/" \
	$col/i3-1.tmp > $col/i3-2.tmp

sed "s/color0/\
	$(cat $col/i3-temp.color | grep or0 | cut -d "=" -f 2)/" \
	$col/i3-2.tmp > $col/i3-3.tmp

sed "s/color5/\
	$(cat $col/i3-temp.color | grep or5 | cut -d "=" -f 2)/" \
	$col/i3-3.tmp > $col/i3-4.tmp

sed "s/color7/\
	$(cat $col/i3-temp.color | grep or7 | cut -d "=" -f 2)/" \
	$col/i3-4.tmp > $col/i3-5.tmp

sed "s/color8/\
	$(cat $col/i3-temp.color | grep or8 | cut -d "=" -f 2)/" \
	$col/i3-5.tmp > $col/i3-6.tmp

sed "s/color9/\
	$(cat $col/i3-temp.color | grep or9 | cut -d "=" -f 2)/" \
	$col/i3-6.tmp > $col/i3-7.tmp

### Generate xres-temp.color for .Xresources
# awk is used to delete several contained patterns
# sed is intended to substitute multiple patterns
# the syntax can be used interchangeably of course

awk '!/foreground_bold|cursor/' \
	$col/temp.color > $col/xres-temp.color && \

sed "s/\$fg-col/\
	$(cat $col/xres-temp.color | grep foreground \
	| cut -d "=" -f 2 | cut -d " " -f 2)/g" \
	$col/xres.color > $col/xr-1.tmp
	
sed "s/\$bg-col/\
	$(cat $col/xres-temp.color | grep background \
	| cut -d "=" -f 2 | cut -d " " -f 2)/g" \
	$col/xr-1.tmp > $col/xr-2.tmp
	
sed "s/\$col-00/$(cat $col/xres-temp.color \
	| grep color0 | head -n 1 | cut -d "=" -f 2 \
	| cut -d " " -f 2)/g" \
	$col/xr-2.tmp > $col/xr-3.tmp
	
sed "s/\$col-01/$(cat $col/xres-temp.color \
	| grep color1 | head -n 1 | cut -d "=" -f 2 \
	| cut -d " " -f 2)/g" \
	$col/xr-3.tmp > $col/xr-4.tmp
	
sed "s/\$col-02/\
	$(cat $col/xres-temp.color | grep color2 \
	| cut -d "=" -f 2 | cut -d " " -f 2)/" \
	$col/xr-4.tmp > $col/xr-5.tmp
	
sed "s/\$col-03/\
	$(cat $col/xres-temp.color | grep color3 \
	| cut -d "=" -f 2 | cut -d " " -f 2)/" \
	$col/xr-5.tmp > $col/xr-6.tmp
	
sed "s/\$col-04/\
	$(cat $col/xres-temp.color | grep color4 \
	| cut -d "=" -f 2 | cut -d " " -f 2)/" \
	$col/xr-6.tmp > $col/xr-7.tmp
	
sed "s/\$col-05/\
	$(cat $col/xres-temp.color | grep color5 \
	| cut -d "=" -f 2 | cut -d " " -f 2)/" \
	$col/xr-7.tmp > $col/xr-8.tmp
	
sed "s/\$col-06/\
	$(cat $col/xres-temp.color | grep color6 \
	| cut -d "=" -f 2 | cut -d " " -f 2)/" \
	$col/xr-8.tmp > $col/xr-9.tmp
	
sed "s/\$col-07/\
	$(cat $col/xres-temp.color | grep color7 \
	| cut -d "=" -f 2 | cut -d " " -f 2)/" \
	$col/xr-9.tmp > $col/xr-10.tmp
	
sed "s/\$col-08/\
	$(cat $col/xres-temp.color | grep color8 \
	| cut -d "=" -f 2 | cut -d " " -f 2)/" \
	$col/xr-10.tmp > $col/xr-11.tmp
	
sed "s/\$col-09/\
	$(cat $col/xres-temp.color | grep color9 \
	| cut -d "=" -f 2 | cut -d " " -f 2)/" \
	$col/xr-11.tmp > $col/xr-12.tmp
	
sed "s/\$col-10/\
	$(cat $col/xres-temp.color | grep color10 \
	| cut -d "=" -f 2 | cut -d " " -f 2)/" \
	$col/xr-12.tmp > $col/xr-13.tmp
	
sed "s/\$col-11/\
	$(cat $col/xres-temp.color | grep color11 \
	| cut -d "=" -f 2 | cut -d " " -f 2)/" \
	$col/xr-13.tmp > $col/xr-14.tmp
	
sed "s/\$col-12/\
	$(cat $col/xres-temp.color | grep color12 \
	| cut -d "=" -f 2 | cut -d " " -f 2)/" \
	$col/xr-14.tmp > $col/xr-15.tmp
	
sed "s/\$col-13/\
	$(cat $col/xres-temp.color | grep color13 \
	| cut -d "=" -f 2 | cut -d " " -f 2)/" \
	$col/xr-15.tmp > $col/xr-16.tmp
	
sed "s/\$col-14/\
	$(cat $col/xres-temp.color | grep color14 \
	| cut -d "=" -f 2 | cut -d " " -f 2)/" \
	$col/xr-16.tmp > $col/xr-17.tmp
	
sed "s/\$col-15/\
	$(cat $col/xres-temp.color | grep color15 \
	| cut -d "=" -f 2 | cut -d " " -f 2)/" \
	$col/xr-17.tmp > $col/xr-18.tmp

cat $col/termite.col-$1 $termite/config.style > $termite/config
cat $col/i3-7.tmp $i3/config.style > $i3/config
mv $col/xr-18.tmp ~/.Xresources && xrdb -merge ~/.Xresources
rm $col/*.tmp $col/*-temp.color
