runtime! archlinux.vim

"	PLUGIN
call plug#begin('~/.vim/plugged')
Plug 'vim-pandoc/vim-rmarkdown'		" RMarkdown function through vim
Plug 'nathangrigg/vim-beancount' 	" Beancount plugin
Plug 'vim-pandoc/vim-pandoc-syntax' 	" Highlight pandoc syntax
Plug 'lilydjwg/colorizer' 		" Colorize #RRGGBB etc
Plug 'vim-syntastic/syntastic' 		" File syntax
Plug 'vim-airline/vim-airline' 		" Airline..
Plug 'vim-airline/vim-airline-themes' 	" ..and its theme
Plug 'jpalardy/vim-slime'		" Slime plug-in to interpret code
Plug 'neo4j-contrib/cypher-vim-syntax'	" Syntax highlight for cypher
call plug#end()

"	GENERAL CONFIG
colorscheme elflord
filetype plugin on
set directory=/mnt/data/.cache/vim/swap
set backupdir=/mnt/data/.cache/vim/bak
set path+=**    " Enable find in current pwd
set number relativenumber expandtab wildmenu
set mouse=a clipboard^=unnamed
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

"	OMNI-COMPLETION
filetype plugin on
set omnifunc=syntaxcomplete#complete

"	SPECIFIC CONFIG

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

"	KEYMAP

" Buffer management
nnoremap tn :find<Space>
nnoremap tk :bprev<CR>
nnoremap tj :bnext<CR>
nnoremap th :bfirst<CR>
nnoremap tl :blast<CR>
nnoremap tq :bdelete<CR>

" Easy folding toggle
nnoremap <space> za

" Copy to system clipboard (need `set clipboard=unnamed`)
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

" Split navigations
nnoremap <C-J> <C-W><C-J>
nnoremap <C-K> <C-W><C-K>
nnoremap <C-L> <C-W><C-L>
nnoremap <C-H> <C-W><C-H>

"	BUFFER OPTIONS
autocmd BufEnter *rc loadview
<<<<<<< HEAD
autocmd BufEnter *conf loadview
=======
autocmd BufLeave *rc mkview
autocmd BufEnter *conf loadview
autocmd BufLeave *conf mkview
>>>>>>> d2b3ef88559eea853bdf0a75a863f1b1a69222b3
autocmd BufNewFile *.Rmd 0r $HOME/.vim/skeleton/skel-rmd
