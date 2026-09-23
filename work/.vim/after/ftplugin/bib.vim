setlocal tabstop=2
setlocal softtabstop=2
setlocal expandtab
setlocal autoindent

" Foldexpr for bibliography file
function! FoldBib()
	let line = getline(v:lnum)
	if match(line, '^@') >= 0
		return ">1"
	else
		return "="
	endif
endfunction

setlocal foldmethod=expr
setlocal foldexpr=FoldBib()
