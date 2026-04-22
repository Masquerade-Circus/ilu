# ilu

Small Node.js CLI utilities for personal productivity.

`ilu` currently includes todo lists, note lists, boards, translation, saved clocks, Git-based sync, and text-to-speech.

## Install

### Run from this repository

```bash
npm install
node bin/cli.js --help
```

The main CLI entry point in this repo is `bin/cli.js`.

### Install globally

You can expose the `ilu` command globally from this repository with either:

```bash
npm install -g .
```

or:

```bash
npm link
```

Then verify the installed CLI:

```bash
ilu --version
ilu --help
```

## Usage

```bash
ilu <command> [options]
```

Available commands:

| Command | Alias | Purpose |
| --- | --- | --- |
| `todo` | `t` | Manage tasks and todo lists |
| `note` | `n` | Manage notes and note lists |
| `board` | `bd` | Manage cards and boards |
| `sync` | — | Sync local data with a Git remote |
| `babel` | `b` | Translate text |
| `clock` | `c` | Manage saved clocks |
| `tts` | — | Convert `.txt` or `.md` files to audio |

Most resource commands default to their show/list behavior when run without flags.

## Commands overview

### `todo` / `t`

Manage tasks for the current active todo list and the todo list collection.

Common options:

- `--add`
- `--details`
- `--edit`
- `--show`
- `--check`
- `--remove`
- `--lists`
- `--use-list`
- `--add-list`
- `--edit-list`
- `--remove-list`

Notes:

- `ilu todo` shows tasks from the current todo list by default.
- Todo list lifecycle management lives under `ilu todo`.

### `note` / `n`

Manage notes for the current active note list and the note list collection.

Common options:

- `--add`
- `--details`
- `--edit`
- `--show`
- `--remove`
- `--lists`
- `--use-list`
- `--add-list`
- `--edit-list`
- `--remove-list`

Notes:

- `ilu note` shows notes from the current note list by default.
- Note list lifecycle management lives under `ilu note`.
- `--add` and `--edit` use an inline terminal prompt for note content.

### `board` / `bd`

Manage cards for the current board and board collection.

Common options:

- `--show`
- `--add`
- `--details`
- `--edit`
- `--move`
- `--priority`
- `--remove`
- `--columns`
- `--list-boards`
- `--use-board`
- `-ab`, `--add-board`
- `-eb`, `--edit-board`
- `-rb`, `--remove-board`

Notes:

- `ilu board` runs `--show` by default.
- Board lifecycle management lives under `ilu board`.
- New boards start with `Backlog`, `Ready`, `In Progress`, and `Done` unless custom columns are chosen.

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

- Translation uses the current Node.js runtime `fetch` implementation.
- The translated text is copied to the clipboard.

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

Notes:

- `ilu clock` shows saved clocks by default.
- Clocks are stored in `~/.ilu/clocks.json`.
- Each clock requires an IANA timezone and a display name.

### `tts`

Convert a text or markdown file to audio.

```bash
ilu tts <inputFile> <outputFile>
ilu tts voice
```

Behavior:

- Input files must use `.txt` or `.md`.
- `ilu tts voice` opens an interactive voice selector and persists the default voice.
- TTS configuration is stored in `~/.ilu/.config/tts-config.json`.
- The OpenAI API key is also stored in that file once provided.
- The default model is `gpt-4o-mini-tts`.
- The default voice is `alloy` until another voice is saved.
- Long inputs are chunked before synthesis.
- Chunk files are written to a temporary numbered parts directory next to the output file.
- If generation is interrupted, existing numbered chunk files are reused on retry.
- Final audio is merged with `ffmpeg`.

### `sync`

Manage automatic sync of local `ilu` data with a Git remote.

```bash
ilu sync init --remote <url> [--branch main]
ilu sync status
ilu sync retry
ilu sync enable
ilu sync disable
```

Behavior:

- Sync is local-first: local writes happen before remote sync work.
- `sync init` requires a remote URL and defaults to branch `main`.
- Sync configuration is stored in `~/.ilu/.config/sync-config.json`.
- Runtime sync state is stored in `~/.ilu/.config/sync-state.json`.
- Sync tracks local data files under `~/.ilu/` and initializes a Git repository there.
- Sync currently tracks `todos.json`, `notes.json`, `boards.json`, and `clocks.json`.
- `.config/` is intentionally excluded from synced data.
- `sync retry` triggers a new sync attempt for pending work.
- `sync enable` and `sync disable` toggle sync in local config/state.
- `sync status` reports the current runtime status and may also show pending remote work or the last error kind.
- If remote sync fails, local data remains on disk.
- `sync init` stops when both local data and remote history already exist, to avoid overwriting data.

## Local data and config

`ilu` stores local state under:

```text
~/.ilu/
```

Current data files:

- `~/.ilu/todos.json`
- `~/.ilu/notes.json`
- `~/.ilu/boards.json`
- `~/.ilu/clocks.json`

Current config/runtime files:

- `~/.ilu/.config/sync-config.json`
- `~/.ilu/.config/sync-state.json`
- `~/.ilu/.config/tts-config.json`

Notes:

- `.config/` is local configuration/runtime state, not synced user data.

## Interactive behavior

Commands that create or edit data are designed for interactive terminal use.

If an interactive command runs without a TTY, `ilu` exits with a clean error instead of a prompt stack trace.

## Testing

Run the test suite with:

```bash
npm test
```

Current `npm test` runs:

```bash
node --test
```
