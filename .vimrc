runtime! archlinux.vim

"	PLUGIN
call plug#begin('~/.vim/plugged')
Plug 'vim-pandoc/vim-rmarkdown'		    " RMarkdown function through vim
Plug 'vim-pandoc/vim-pandoc-syntax' 	" Highlight pandoc syntax
Plug 'quarto-dev/quarto-vim'            " Highlight quarto syntax
Plug 'lilydjwg/colorizer' 	            " Colorize #RRGGBB etc
Plug 'vim-syntastic/syntastic' 		    " File syntax
Plug 'vim-airline/vim-airline' 		    " Airline..
Plug 'vim-airline/vim-airline-themes' 	" ..and its theme
Plug 'jpalardy/vim-slime'		        " Slime plug-in to interpret code
Plug 'junegunn/fzf.vim'             	" Vim fuzzy finder
Plug 'arcticicestudio/nord-vim'         " Nord colorscheme
Plug 'elzr/vim-json'                    " JSON syntax formatting
call plug#end()

" Lilypond integration
let $lilypath = glob("`readlink -f /usr/**/lilypond/**/vim`")
if isdirectory($lilypath)   " Check if dir exists
        filetype off
        set runtimepath+=$lilypath
        filetype on
endif

"	OMNI-COMPLETION
filetype plugin on
set omnifunc=syntaxcomplete#Complete

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
let g:airline_theme = 'atomic'
let g:airline#extensions#tabline#enabled = 1

" Vim slime config
let g:slime_target = "tmux"
let g:slime_paste_file = "$HOME/.tmp/slime_paste"
let g:slime_default_config = {"socket_name": "default", "target_pane": ":.0"}

" Netrw config
let g:netrw_bufsettings = "noma nomod nobl nowrap ro nu relativenumber"
let g:netrw_banner = 0

" Vim JSON config
let g:vim_json_syntax_conceal = 0

"	KEYMAP

" Buffer and tab management
nnoremap tn :Files<CR>
nnoremap tN :GFiles<CR>
nnoremap tb :Buffers<CR>
nnoremap tk :bprev<CR>
nnoremap tj :bnext<CR>
nnoremap tq :bdelete<CR>
nnoremap ttn :tabnew<CR>
nnoremap ttk :tabprev<CR>
nnoremap ttj :tabnext<CR>
nnoremap tth :tabfirst<CR>
nnoremap ttl :tablast<CR>
nnoremap ttq :tabclose<CR>

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

" Split navigations and resizing
nnoremap <C-H> <C-W><C-H>
nnoremap <C-J> <C-W><C-J>
nnoremap <C-K> <C-W><C-K>
nnoremap <C-L> <C-W><C-L>
nnoremap <Leader>[ :vertical resize -10 <CR>
nnoremap <Leader>- :resize +10 <CR>
nnoremap <Leader>= :resize -10 <CR>
nnoremap <Leader>] :vertical resize +10 <CR>

"	BUFFER OPTIONS

autocmd BufEnter *rc loadview
autocmd BufEnter *conf loadview

"	GENERAL CONFIG

if isdirectory("/home/lam/data") " Check if dir exists to set swap and backup
        set directory=/home/lam/data/.cache/vim/swap
        set backupdir=/home/lam/data/.cache/vim/bak
endif

syntax on
colorscheme nord " Selection: elflord, pablo, industry
set path+=**    " Enable find in current pwd
set number relativenumber expandtab wildmenu
set nocursorline nocursorcolumn
set mouse=a clipboard^=unnamed
set hls is smartcase ignorecase
set splitbelow splitright
set spelllang=en,id
set encoding=utf-8
set t_Co=256

" Highlight
hi StatusLine   ctermbg=None   ctermfg=White
hi CursorLine   term=None      cterm=None     ctermbg=None
hi CursorColumn term=None      cterm=None     ctermbg=None
hi Search       ctermbg=Yellow ctermfg=Black
hi CurSearch    ctermbg=Yellow ctermfg=Black

hi Folded       ctermbg=None
hi FoldColumn   ctermbg=None

hi Conceal      ctermbg=None
hi SignColumn   ctermbg=Black    ctermfg=Grey
hi MatchParen   ctermbg=DarkGray ctermfg=White
hi visual       cterm=bold       ctermbg=Black

hi SpellBad     ctermbg=None   ctermfg=Red
hi SpellCap     ctermbg=None   ctermfg=81
hi SpellRare    ctermbg=None   ctermfg=225
hi SpellLocal   ctermbg=None   ctermfg=14

hi DiffAdd      ctermfg=Black
hi DiffChange   ctermfg=Black
hi DiffDelete   ctermfg=Black
hi DiffText     ctermfg=Black

hi LineNr       ctermbg=Blue   ctermfg=Black guifg=Black term=Bold cterm=Bold
hi LineNrAbove  ctermbg=None   ctermfg=Grey
hi LineNrBelow  ctermbg=None   ctermfg=Grey
