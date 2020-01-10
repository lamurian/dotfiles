setlocal spell
setlocal textwidth=79

" Foldexpr for markdown flavours
function! FoldMD()
    let line = getline(v:lnum)
    if match(line, '^#') >= 0
        return ">1"	" headings
	elseif match(line, '^---') >= 0	&& v:lnum == 1
		return ">2"	" yaml
    elseif match(line, '^`*{') >= 0
        return ">2"	" code block
    else
        return "="
    endif
endfunction

setlocal foldmethod=expr
setlocal foldexpr=FoldMD()
