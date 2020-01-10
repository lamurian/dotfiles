setlocal shiftwidth=4
setlocal textwidth=79
setlocal fileformat=unix 
setlocal tabstop=4
setlocal softtabstop=4
setlocal expandtab
setlocal autoindent

" Foldexpr for python, matlab and R
function! FoldCode()
	let line = getline(v:lnum)
	let after = getline(v:lnum+1)
	if match(line, '^\(#\|%%\)') >= 0
		return ">1"	" comment or matlab fold
	elseif match(line, '^%\|\(function\|def.*:\)') >= 0
		return ">2"	" func or matlab comment
	elseif match(line, '^\s*$') >= 0 && match(after, '^\s*$') >= 0
		return 0	" consecutive empty lines
	else
		return "="
	endif
endfunction

setlocal foldmethod=expr
setlocal foldexpr=FoldCode()
