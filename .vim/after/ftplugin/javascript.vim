setlocal tabstop=2
setlocal softtabstop=2
setlocal shiftwidth=2 

" Foldexpr for latex and noweb files
function! FoldCode()
        let line = getline(v:lnum)
        let prior = getline(v:lnum-1)
        if match(line, '^\(\\documentclass\|%\+\)') >= 0
                return ">1"     " Start of document, section, or double comment
        "elseif match(line, '^%\s\+') >= 0
        "        return ">2"     " Single comment
        elseif match(line, '^\\\(\(sub\)*section\|chapter\|begin{\w\+}\)') >= 0
                return ">2"     " Single comment
        elseif match(line, '^$\|\\end{\w\+}') >= 0 && match(prior, '^$') >= 0
		return 0	" consecutive empty lines
        else
                return "="
        endif
endfunction

setlocal foldmethod=expr
setlocal foldexpr=FoldCode()
