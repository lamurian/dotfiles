setlocal shiftwidth=2
setlocal fileformat=unix 
setlocal tabstop=2
setlocal softtabstop=2
setlocal expandtab
setlocal autoindent

" Foldexpr for python, matlab and R
function! FoldCode()
	let line = getline(v:lnum)
	let prior = getline(v:lnum-1)
	if match(line, '^/\*') >= 0
		return ">1"	" Multi-line comment
        elseif match(line, '^//') >= 0
		return ">1"	" Single-line comment
	elseif match(line, '\s\+//') >= 0
		return ">2"	" Indented comment
	elseif match(line, '^\s*$') >= 0 && foldlevel(prior) != 0
                return ">1"
	elseif match(line, '^\s*$') >= 0 && match(prior, '^$') >= 0
		return 0	" consecutive empty lines
	else
		return "="
	endif
endfunction

setlocal foldmethod=expr
setlocal foldexpr=FoldCode()
