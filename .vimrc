runtime! archlinux.vim



" " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " "
"	PLUGIN
" " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " "

call plug#begin('~/.vim/plugged')
Plug 'vim-pandoc/vim-pandoc' 		" Pandoc plugin
Plug 'nathangrigg/vim-beancount' 	" Beancount plugin
Plug 'dhruvasagar/vim-table-mode' 	" Easy markdown table with \tm
Plug 'vim-pandoc/vim-rmarkdown'		" RMarkdown function through vim
Plug 'vim-pandoc/vim-pandoc-syntax' 	" Highlight pandoc syntax
Plug 'lilydjwg/colorizer' 		" Colorize #RRGGBB etc
Plug 'vim-syntastic/syntastic' 		" File syntax
Plug 'vim-airline/vim-airline' 		" Airline..
Plug 'vim-airline/vim-airline-themes' 	" ..and its theme
Plug 'Valloric/YouCompleteMe' 		" Powerful autocompletion
Plug 'jpalardy/vim-slime'		" Slime plug-in to interpret code
Plug 'neo4j-contrib/cypher-vim-syntax'	" Syntax highlight for cypher
call plug#end()



" " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " "
"	GENERAL CONFIG
" " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " "

colorscheme elflord
set number relativenumber
set mouse=a clipboard^=unnamed
set hls is smartcase ignorecase
set splitbelow splitright
set spelllang=en,id
set encoding=utf-8
set cursorline cursorcolumn
set t_Co=256
hi CursorLine cterm=None ctermbg=Black ctermfg=White
hi CursorColumn ctermbg=Black ctermfg=White



" " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " "
"	OMNI-COMPLETION
" " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " "
filetype plugin on
set omnifunc=syntaxcomplete#complete



" " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " "
"	SPECIFIC CONFIG
" " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " "

" Beancount config
let g:beancount_account_completion = 'chunks'
let g:table_mode_corner='|'

" Pandoc config
let g:pandoc#folding#level = '1'
" let g:pandoc#command#autoexec_on_writes = '1'
" let g:pandoc#command#autoexec_command = 'Pandoc pdf'

" Syntastic config
set statusline+=%#warningmsg#
set statusline+=%{SyntasticStatuslineFlag()}
set statusline+=%*
let g:syntastic_always_populate_loc_list = 1
let g:syntastic_auto_loc_list = 1
let g:syntastic_check_on_open = 1
let g:syntastic_check_on_wq = 0
let g:syntastic_python_checkers = ['python3']

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

"inoremap sclm <ESC>
"vnoremap sclm <ESC>

" Tab management
nnoremap tn :tabnew<Space>
nnoremap tk :tabprev<CR>
nnoremap tj :tabnext<CR>
nnoremap th :tabfirst<CR>
nnoremap tl :tablast<CR>

" $LaTeX$ syntax to beautify pandoc
inoremap --> $\to$

" Easy folding toggle
nnoremap <space> za

" Copy to system clipboard
" Use in accordance with set clipboard=unnamed
nnoremap y "+y
nnoremap Y "+Y
nnoremap p "+p
nnoremap P "+P
nnoremap d "+d
nnoremap D "+D
vnoremap y "+y
vnoremap Y "+Y
vnoremap p "+p
vnoremap P "+P
vnoremap d "+d
vnoremap D "+D

" Autocomplete bracket
inoremap ( ()<ESC>i
inoremap { {}<ESC>i
inoremap [ []<ESC>i
inoremap <Leader><TAB> <ESC>/<++><return>da>a

" Split navigations
nnoremap <C-J> <C-W><C-J>
nnoremap <C-K> <C-W><C-K>
nnoremap <C-L> <C-W><C-L>
nnoremap <C-H> <C-W><C-H>



" " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " "
"	NEW BUFFER
" " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " "

autocmd BufNewFile *.Rmd 0r $HOME/.vim/skeleton/skel-rmd

au BufNewFile,BufRead *.Rmd set textwidth=79

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
