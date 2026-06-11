# AGENTS.md

## Descripción del proyecto

`ilu` es una CLI CommonJS de productividad personal. Expone el binario `ilu` desde `./bin/cli.js` y conserva comandos existentes para tareas como todo, notes, board, clocks, configuración y sync. El runner raíz actual es `node --test`.

La TUI vive en `ui/` y usa `@valyrianjs/terminal` junto con `valyrian.js`. El objetivo de la migración actual es componentizar solo la capa `ui/` hacia TSX sin convertir el repo completo a TypeScript, ESM o Bun.

## Acuerdos vigentes para la migración UI

- Migrar solo `ui/`; no reescribir CLI, modelos, sync, comandos root ni Inquirer.
- Mantener `ui/app.tsx` como entrypoint real de la TUI. No dejar `ui/app.js` como shim final; los callers CommonJS deben registrar `tsx/cjs` y cargar `ui/app.tsx` directamente.
- Mantener CLI CommonJS y no convertir todo el repo a TS/ESM.
- Preferir `tsx` si el spike confirma compatibilidad; Bun solo comparación y no default salvo evidencia fuerte.
- Normalizar imports/requires en la zona UI.
- La selección de cards debe usar eventos semánticos/identidad de card; evita matemática frágil de coordenadas y parches tipo `clickAt` como fuente primaria.
- No mover root `ilu` a TUI todavía.
- No eliminar Inquirer todavía.
- No cambiar política de ancho de columnas por ahora; no implementar content-aware widths.
- No usar sync runtime manual en TUI; los mutadores de modelos disparan hook existente.
- Mantener 80x24 sin overdraw.
- Top nav app chrome solo: Todo, Notes, Board, Clocks.
- Board action bar contextual fija sobre footer.
- Footer fixed al fondo: status izquierda, clocks compactos derecha sin nombres.
- Elementos de listados deben usar eventos propios y primitives de Valyrian; acciones visibles/clicables, keymaps solo fallback.

## Regla obligatoria para Valyrian terminal

Antes de cambiar código que use `@valyrianjs/terminal`, lee `node_modules/@valyrianjs/terminal/llms-full.txt` y, cuando haga falta confirmar detalles de implementación, revisa `node_modules/@valyrianjs/terminal/src` como fuente primaria. No uses `dist` como contrato principal.

## Validación esperada

- Ejecuta pruebas relevantes con `node --test` o subsets de `tests/` cuando el cambio lo permita.
- Mantén fixtures y pruebas aisladas del `HOME` real.
- No hagas commits ni operaciones VCS que modifiquen estado salvo instrucción explícita del usuario.
