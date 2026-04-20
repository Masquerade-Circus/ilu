# ilu

Small Node.js CLI utilities for personal productivity.

`ilu` currently includes:

- todo items and todo lists
- notes and note lists
- quick text translation
- saved world clocks

## Roadmap

- [x] Todos
- [x] Simple notes
- [x] Translator
- [x] World clock
- [ ] Kanban boards
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
- `~/.ilu/clocks.json`
- `~/.ilu/note.txt`

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
