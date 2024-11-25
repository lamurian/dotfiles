" For `*.md` and `*.Rmd` files

setlocal shiftwidth=2
setlocal tabstop=2
setlocal softtabstop=2
setlocal expandtab
setlocal spell
abbr -> $\to$

" Zettelkasten note linking
function! LinkZettel()
        " Use the provided zettel_dir or default to the current file's directory
        let zettel_dir = expand('%:p:h:h') " Default to current file's directory

        " Use FZF to select a note from the specified zettel_dir
        let selected_file = system('find ' . zettel_dir . ' -type f -name "*.md" | fzf --preview "head -n 100 {}" --border double --tmux')
        let selected_file = substitute(selected_file, '\n\+$', '', '')

        if v:shell_error == 0 && !empty(selected_file)
                let note_file = fnamemodify(selected_file, ':t:r') " Extract file name without path and .md extension
                let note_link = fnamemodify(selected_file, ':.' . zettel_dir) " Extract full file name (with .md extension)

                " Ask the user for alternative text (alt-name)
                let alt_text = input('Enter alternative text: ')
                let alt_text = empty(alt_text) ? note_file : alt_text " Use the note title fo no alt text provided

                " Insert the markdown link at the current cursor position
                let link_text = '[' . alt_text . '](' . note_link . ') '

                " Append link text to the current line
                let line = getline('.')
                let cursor = col('.')
                let line = strpart(line, 0, cursor) . link_text . strpart(line, cursor)
                call setline('.', line)
        endif
endfunction

nnoremap <leader>zk :call LinkZettel()<CR>

" Foldexpr for markdown flavours
function! FoldMD()
	let line = getline(v:lnum)
	let prior = getline(v:lnum-1)
	if match(line, '^#') >= 0
		return ">1"	" headings
	elseif match(line, '^---') >= 0 && v:lnum == 1
		return ">2"	" yaml
	elseif match(line, '^`*{') >= 0
		return ">2"	" code block
	elseif match(prior, '^```$') >= 0
		return "<2"	" end of code block
	else
		return "="
	endif
endfunction

setlocal foldmethod=expr
setlocal foldexpr=FoldMD()
