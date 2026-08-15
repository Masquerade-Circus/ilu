# Reproducible terminal capture

The capture mounts the real TUI from `ui/app.tsx` against a synthetic HOME under `./.tmp/capture/home`. The capture runner invokes the same production keymap and persistence actions as the interactive CLI. It renders the TUI's official plain terminal frame with a fixed high-contrast foreground so the docs remain legible across capture hosts. Sync stays disabled, and the tapes never open Translate, Speech, clipboard, or remote Git flows.

## Local tools

The verified capture environment uses:

- VHS `v0.11.0`, SHA-256 `99cb634587eaae0473c1ea377db80c3a048c27f99fe0a7febb1a1e8cb7ee5009`
- ttyd `1.7.7`, SHA-256 `8a217c968aba172e0dbf3f34447218dc015bc4d5e59bf51db2f2cd12b7be4f55`
- ffmpeg `6.1.1`

Keep VHS and ttyd at `./.tmp/tools/bin/vhs` and `./.tmp/tools/bin/ttyd`. Both upstream archives come from their official GitHub releases. Verify each download against the checksum file published with that release before use.

## Capture

From the repository root:

```bash
docs/demos/capture-terminal-demo.sh
```

The script resets only the known synthetic fixture files inside `./.tmp/capture/home/.ilu`, captures the Board frame, resets the fixtures, and captures the Todo to Board workflow. It writes:

- `docs/assets/ilu-board.png`
- `docs/assets/ilu-workflow.gif`
- `docs/assets/ilu-workflow.webm`

VHS receives a 1200 by 720 pixel canvas, 16 pixel monospace text, a 25 FPS capture rate, and no desktop decoration. The capture runner closes each TUI session through its public `destroy()` lifecycle after the scripted sequence ends.
