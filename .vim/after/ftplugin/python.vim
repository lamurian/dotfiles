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
	let prior = getline(v:lnum-1)
	if match(line, '^#') >= 0
		return ">1"	" comment
	elseif match(line, '^\(class\|def\).*:') >= 0
		return ">2"	" function or class
	elseif match(line, '^$') >= 0 && match(prior, '^$') >= 0
		return 0	" consecutive empty lines
	else
		return "="
	endif
endfunction

setlocal foldmethod=expr
setlocal foldexpr=FoldCode()
