" For `*.qmd`

setlocal shiftwidth=2
setlocal tabstop=2
setlocal softtabstop=2
setlocal expandtab
setlocal spell
setlocal autoindent
abbr -> $\to$

" Foldexpr for markdown flavours
function! FoldMD()
	let line = getline(v:lnum)
	let prior = getline(v:lnum-1)
	if match(line, '^#\(.*[|~]\)\@!') >= 0
		return ">1"	" headings
	elseif match(line, '^---') >= 0 && v:lnum == 1
		return ">2"	" yaml
	elseif match(line, '^`*{') >= 0
		return ">2"	" code block
	elseif match(prior, '^```$') >= 0
		return "<2"	" end of code block
	elseif match(line, '^:\+ {') >= 0
		return ">2"	" class
	elseif match(prior, '^:::$') >= 0
		return "<2"	" end of class
	else
		return "="
	endif
endfunction

setlocal foldmethod=expr
setlocal foldexpr=FoldMD()
