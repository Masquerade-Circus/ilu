# Plan: migración incremental de `ui/` a TSX componentizado

Fecha: 2026-06-03

## Objetivo

Migrar incrementalmente solo `ui/` desde `ui/app.js` monolítico hacia una estructura TSX/componentizada coherente, preservando CLI CommonJS, runner raíz actual, Inquirer y comportamiento actual.

## Estructura objetivo acordada

```txt
ui/
  components/
    Button.tsx
    TopNav.tsx
    AppShell.tsx
    Footer.tsx
    Overlay.tsx

  pages/
    board/
      MainView.tsx
      BoardColumn.tsx
      BoardCard.tsx
      BoardActionBar.tsx
      overlays/        # opcional si reduce complejidad

  runtime/             # opcional si el boundary TSX lo justifica
  state/               # opcional para eventos/estado
  models/              # opcional para contracts/snapshot
```

## Decisiones tomadas

- Migrar solo `ui/`; no reescribir CLI, modelos, sync, comandos root ni Inquirer.
- Mantener `ui/app.js` como boundary público CommonJS compatible con callers actuales.
- Mantener CLI CommonJS y no convertir todo el repo a TS/ESM.
- Preferir `tsx` si el spike confirma compatibilidad; Bun solo comparación y no default salvo evidencia fuerte.
- Normalizar imports/requires en la zona UI.
- Rehacer selección de cards con eventos semánticos/identidad de card, no con matemática frágil de coordenadas ni parches tipo `clickAt`.
- Usar `node_modules/@valyrianjs/terminal/llms-full.txt` y `node_modules/@valyrianjs/terminal/src` como fuente primaria para Valyrian terminal; no basarse en `dist` como contrato principal.
- No mover root `ilu` a TUI todavía.
- No eliminar Inquirer todavía.
- No cambiar política de ancho de columnas por ahora; no implementar content-aware widths.
- No usar sync runtime manual en TUI; los mutadores de modelos disparan hook existente.
- Mantener 80x24 sin overdraw.
- Top nav app chrome solo: Todo, Notes, Board, Clocks.
- Board action bar contextual fija sobre footer.
- Footer fixed al fondo: status izquierda, clocks compactos derecha sin nombres.
- Elementos de listados deben usar eventos propios y primitives de Valyrian; acciones visibles/clicables, keymaps solo fallback.

## Fases aprobadas

0. Guardar plan en `docs/plans/` y crear `AGENTS.md` root antes de tocar implementación.
1. Spike `tsx` vs Bun con criterios explícitos: elegir el camino que preserve boundary CommonJS, CLI actual, suite raíz actual, integración Valyrian y menor disrupción. Si se usan temporales, deben ir dentro de `./tmp` del repo.
2. Establecer boundary TSX solo para `ui/` manteniendo `ui/app.js` como entrypoint CommonJS.
3. Normalizar contratos/imports/requires dentro de UI.
4. Extraer componentes base: Button, TopNav, AppShell, Footer, Overlay.
5. Extraer página Board: MainView, BoardColumn, BoardCard, BoardActionBar; overlays de board solo si reducen complejidad.
6. Rehacer selección de cards mediante eventos semánticos/identidad de card.
7. Preservar comportamiento actual de Board/TUI: Split columns, gutters, backgrounds, ScrollView por columna, header fijo, cards wrapped, todos los cards accesibles por scroll, selección visible, Details/Edit/Move/Priority/Remove tras selección, action bar, footer y 80x24.
8. Actualizar estrategia/fixtures de validación manteniendo aislamiento de HOME real.
9. Si cambia copy visible, pedir revisión a `senda` en una fase posterior; por ahora reportar si hubo copy visible modificado y cuáles textos.
10. Dejar evidencia completa de lo hecho y de cómo se validó.

## Follow-ups de plan-reviewer

- El spike debe dejar criterio explícito de decisión `tsx` vs Bun para evitar preferencia subjetiva.
- La ejecución debe conservar conflictos/seguridad de validación global por áreas tocadas.
- Temporales solo en `./tmp` del repo.
