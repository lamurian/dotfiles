#!/usr/bin/Rscript
library(rmarkdown)

rmdfile = commandArgs(trailingOnly=T)
rmarkdown::render(rmdfile)
