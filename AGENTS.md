# AGENTS.md

## Descripción del proyecto

`ilu` es una CLI de productividad personal ejecutada desde TypeScript con `tsx`. Expone el binario `ilu` desde `./bin/cli.js`; ese archivo es el único JavaScript propio permitido y solo registra `tsx/cjs` para cargar el ejecutor real `cli.ts`. La CLI conserva comandos existentes para tareas como todo, notes, board, clocks, configuración y sync. El runner raíz actual es el runner de Node con preload de `tsx`.

La TUI vive en `ui/` y usa `@valyrianjs/terminal` junto con `valyrian.js`. `ui/app.tsx` es el entrypoint real de la TUI.

## Acuerdos vigentes para TypeScript y runtime

- Mantener `bin/cli.js` como bootstrap mínimo con shebang, `require('tsx/cjs')` y carga de `../cli.ts`.
- Mantener `cli.ts` como ejecutor real de CLI y `ui/app.tsx` como entrypoint real de TUI.

## Regla obligatoria para Valyrian terminal

Antes de cambiar código que use `@valyrianjs/terminal`, lee `node_modules/@valyrianjs/terminal/llms-full.txt` y, cuando haga falta confirmar detalles de implementación, revisa `node_modules/@valyrianjs/terminal/src` como fuente primaria.

## Validación esperada

- Ejecuta pruebas relevantes con `npm test`, `npm run typecheck` o subsets de `tests/` cuando el cambio lo permita.
- Mantén fixtures y pruebas aisladas del `HOME` real.
- No hagas commits ni operaciones VCS que modifiquen estado salvo instrucción explícita del usuario.
- No implementes tests de contrato, solo tests de unidad y de integración. Si un test no valida cli o TUI, no debe de existir.
