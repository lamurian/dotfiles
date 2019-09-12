runtime! archlinux.vim



" " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " "
"	PLUGIN
" " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " "

call plug#begin('~/.vim/plugged')
Plug 'vim-airline/vim-airline' 		" Airline..
Plug 'vim-airline/vim-airline-themes' 	" ..and its theme
Plug 'jpalardy/vim-slime'		" Slime plug-in to interpret code
call plug#end()



" " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " "
"	GENERAL CONFIG
" " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " "

colorscheme elflord
syntax on
set number relativenumber
set mouse=a
set hls is smartcase ignorecase
set splitbelow splitright
set spelllang=en,id
set encoding=utf-8
set cursorline cursorcolumn
set t_Co=256
hi CursorLine cterm=None ctermbg=Black
hi CursorColumn cterm=None ctermbg=Black
hi Folded ctermbg=Black
hi FoldColumn ctermbg=Black
hi Conceal ctermbg=Black
hi SpellBad ctermbg=Black ctermfg=Red



" " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " "
"	OMNI-COMPLETION
" " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " "
filetype plugin on
set omnifunc=syntaxcomplete#complete



" " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " "
"	SPECIFIC CONFIG
" " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " "

" Airline config
let g:airline_powerline_fonts = 0
let g:airline_theme = 'peaksea'
let g:airline#extensions#tabline#enabled = 1

" Vim slime config
let g:slime_target = "tmux"
let g:slime_paste_file = "$HOME/.tmp/slime_paste"
let g:slime_default_config = {"socket_name": "default", "target_pane": ":.0"}

" Netrw config
let g:netrw_bufsettings = "noma nomod nobl nowrap ro nu relativenumber"
let g:netrw_banner = 0


" " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " "
"	KEYMAP
" " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " "

" Tab management
nnoremap tn :tabnew<Space>
nnoremap tk :tabprev<CR>
nnoremap tj :tabnext<CR>
nnoremap th :tabfirst<CR>
nnoremap tl :tablast<CR>

" Easy folding toggle
nnoremap <space> za

" Split navigations
nnoremap <C-J> <C-W><C-J>
nnoremap <C-K> <C-W><C-K>
nnoremap <C-L> <C-W><C-L>
nnoremap <C-H> <C-W><C-H>



" " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " "
"	NEW BUFFER
" " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " "

au BufNewFile,BufRead *.py,*.R,*.m
    \ set tabstop=4 |
    \ set softtabstop=4 |
    \ set shiftwidth=4 |
    \ set textwidth=79 |
    \ set expandtab |
    \ set autoindent |
    \ set fileformat=unix 

" Set other indentation
au BufNewFile,BufRead *.js,*.html,*.css,*.sty,*.tex
    \ set tabstop=2 |
    \ set softtabstop=2 |
    \ set shiftwidth=2 
