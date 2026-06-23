# AGENTS.md

## Descripción del proyecto

`ilu` es una CLI de productividad personal ejecutada desde TypeScript con `tsx`. Expone el binario `ilu` desde `./bin/cli.js`; ese archivo es el único JavaScript propio permitido y solo registra `tsx/cjs` para cargar el ejecutor real `cli.ts`. La CLI conserva comandos existentes para tareas como todo, notes, board, clocks, configuración y sync. El runner raíz actual es el runner de Node con preload de `tsx`.

La TUI vive en `ui/` y usa `@valyrianjs/terminal` junto con `valyrian.js`. `ui/app.tsx` sigue siendo el entrypoint real de la TUI. El repositorio completo usa un único `tsconfig.json`; no debe reaparecer `tsconfig.ui.json`, no deben quedar shims JavaScript finales y no se debe convertir el paquete a ESM global.

## Acuerdos vigentes para TypeScript y runtime

- Mantener `bin/cli.js` como bootstrap mínimo con shebang, `require('tsx/cjs')` y carga de `../cli.ts`.
- Mantener `cli.ts` como ejecutor real de CLI y `ui/app.tsx` como entrypoint real de TUI.
- Mantener un solo `tsconfig.json` raíz; no crear ni restaurar `tsconfig.ui.json`.
- No dejar archivos `.js` propios fuera de `bin/cli.js`.
- No introducir Bun, bundlers, build obligatorio ni conversión ESM global.
- Mantener `tsx` como dependencia runtime porque el paquete ejecuta TypeScript sin build previo.
- Mantener el runner de Node para pruebas mediante `npm test`.
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

- Ejecuta pruebas relevantes con `npm test`, `npm run typecheck` o subsets de `tests/` cuando el cambio lo permita.
- Mantén fixtures y pruebas aisladas del `HOME` real.
- No hagas commits ni operaciones VCS que modifiquen estado salvo instrucción explícita del usuario.
