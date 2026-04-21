# ilu

Small Node.js CLI utilities for personal productivity.

`ilu` currently includes:

- todo items and todo lists
- notes and note lists
- scrumban boards
- quick text translation
- saved world clocks

## Roadmap

- [x] Todos
- [x] Simple notes
- [x] Translator
- [x] World clock
- [x] Scrumban boards
- [ ] Callendar and remainders

## Install

### Run from this repository

```bash
npm install
node bin/cli.js --help
```

The real CLI entry point in this repo is `bin/cli.js`.

You can also use:

```bash
node index.js --help
```

### Installed CLI name

The published executable name is:

```bash
ilu
```

If the package is installed globally, you can run commands like:

```bash
ilu --help
ilu todo --show
```

## Usage

```bash
ilu <command> [options]
```

Available commands:

| Command     | Alias | Purpose                               |
| ----------- | ----- | ------------------------------------- |
| `todo`      | `t`   | Manage tasks in the current todo list |
| `todo-list` | `tl`  | Manage todo lists                     |
| `note`      | `n`   | Manage notes in the current note list |
| `note-list` | `nl`  | Manage note lists                     |
| `board`     | `bd`  | Manage cards and boards               |
| `babel`     | `b`   | Translate text                        |
| `clock`     | `c`   | Manage saved clocks                   |

Most resource commands default to `--show` behavior when you run them without flags.

## Interactive behavior

Commands that create or edit data are designed for a human using an interactive terminal.

If an interactive command is run without a TTY, `ilu` exits with a clean error message instead of a prompt stack trace.

## Commands overview

### `todo` / `t`

Manage tasks for the current active todo list.

Common options:

- `--add`
- `--details` — show task details via interactive selection
- `--edit` — edit the selected task interactively
- `--show`
- `--check`
- `--remove` — remove selected tasks interactively

### `todo-list` / `tl`

Manage todo lists.

Common options:

- `--add`
- `--details` — show list details via interactive selection
- `--edit` — edit the selected list interactively
- `--show`
- `--use` — switch to the selected list interactively
- `--current`
- `--remove` — remove selected lists interactively
- `--add-label`
- `--edit-label <position>`
- `--remove-label [position]`

### `note` / `n`

Manage notes for the current active note list.

Common options:

- `--add`
- `--details` — show note details via interactive selection
- `--edit` — edit the selected note interactively
- `--show`
- `--remove` — remove selected notes interactively

Notes:

- `--add` and `--edit` capture note content with an inline terminal prompt
- `Enter` confirms the note content
- `Ctrl+N` inserts a new line in a portable way
- `Shift+Enter` may insert a new line when the terminal reports it, but it is not required
- `Esc` cancels the inline note prompt

### `note-list` / `nl`

Manage note lists.

Common options:

- `--add`
- `--details` — show list details via interactive selection
- `--edit` — edit the selected list interactively
- `--show`
- `--use` — switch to the selected list interactively
- `--current`
- `--remove` — remove selected lists interactively
- `--add-label`
- `--edit-label <position>`
- `--remove-label [position]`

### `babel` / `b`

Translate text.

```bash
ilu babel <text...>
ilu b <text...>
```

Options:

- `--source [source]` — defaults to `auto`
- `--target [target]` — defaults to the current system language at runtime

Notes:

- translation uses the native `fetch` available in the current Node.js runtime
- the translated text is copied to the clipboard

### `board` / `bd`

Manage cards for the current board and board collection.

Common options:

- `--show` — show the current board as an adaptive ASCII view
- `--add` — add a new card to the default column
- `--details` — show details of the selected card interactively
- `--edit` — edit the selected card interactively
- `--move` — move the selected card interactively
- `--priority` — reorder cards within a selected column with keyboard controls
- `--remove` — remove selected cards interactively
- `--columns` — manage columns for the current board with a column-first interactive flow
- `--list-boards` — show all boards
- `--use-board` — switch to the selected board interactively
- `-ab`, `--add-board` — add a new board interactively
- `-eb`, `--edit-board` — edit the selected board interactively
- `-rb`, `--remove-board` — remove selected boards interactively

Notes:

- running `ilu board` with no flags runs `--show` by default
- a new board starts with `Backlog`, `Ready`, `In Progress` and `Done`
- a new board can start with custom columns and a selected default column for new cards
- `ilu board --list-boards` shows the available boards
- `ilu board --use-board` switches the current board interactively
- all board creation and lifecycle management now lives under `ilu board`
- card priority is the card position inside each column
- `ilu board --priority` selects a column first, then enters reorder mode for cards in that same column
- `ilu board --columns` selects a column first, then shows only the actions that make sense for that column
- the priority prompt uses `Space` to take/drop, `↑/↓` to move, `Enter` to confirm, and `Esc` to cancel
- if the selected column has fewer than 2 cards, the command reports that there is nothing to reorder
- moving a card forward triggers auto-pull from earlier columns until a full WIP-limited column stops the chain

### `clock` / `c`

Manage saved clocks.

```bash
ilu clock
ilu c
```

Options:

- `--add` — add a new saved clock
- `--show` — show all saved clocks
- `--remove [position]` — remove one clock by position, or remove all when no position is given

Behavior:

- running `ilu clock` with no flags shows saved clocks by default
- clocks are stored in `~/.ilu/clocks.json`
- each clock requires an IANA timezone and a display name
- output is shown as: time, then name, then timezone
- the output uses color styling for those segments

Example display shape:

```text
1 10:15:20 - CDMX (America/Mexico_City)
```

## Local data

`ilu` stores its local files under:

```text
~/.ilu/
```

Examples used by the current codebase:

- `~/.ilu/todos.json`
- `~/.ilu/notes.json`
- `~/.ilu/boards.json`
- `~/.ilu/clocks.json`

## Testing

Run the test suite with:

```bash
npm test
```

Current `npm test` runs:

```bash
node --test
```

The repository includes CLI and functional tests under `tests/`.
