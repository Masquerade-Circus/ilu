# Arquitectura interna actual de `ilu`

Este documento describe cómo está organizado el código de `ilu` hoy. Su audiencia son contributors que necesitan ubicarse en el repo antes de cambiar comandos, modelos, sincronización, prompts o la TUI.

No es una guía de usuario. Para uso diario de la CLI, lee [`README.md`](../README.md).

## Resumen del runtime

`ilu` publica el binario `ilu` desde `bin/cli.js`. Ese archivo registra `tsx/cjs` y carga `cli.ts`, que es el ejecutor real de la CLI.

La CLI se configura con `commander` en `bin/configure-cli.ts`. `cli.ts` carga los módulos de cada dominio de forma perezosa y delega las acciones al registro de comandos.

La TUI se abre con `ilu ui`. Su entrypoint real es `ui/app.tsx`.

## Entrypoints

| Ruta | Responsabilidad |
| --- | --- |
| `bin/cli.js` | Bootstrap ejecutable del binario `ilu`. Define el `tsconfig` usado por `tsx`, registra `tsx/cjs` y carga `cli.ts`. |
| `cli.ts` | Crea el programa principal, registra dependencias de dominios y ejecuta `program.parse(process.argv)`. |
| `bin/configure-cli.ts` | Declara comandos, aliases, opciones y subcomandos con `commander`. |
| `ui/app.tsx` | Entrypoint real de la TUI. Monta sesiones, compone shell, overlays y vistas activas. |
| `ui/app-keymap.ts` | Keymap global y comandos de navegación de la TUI. |
| `ui/app-snapshot.ts` | Referencia mutable de snapshots para render estático, headless e interactivo. |
| `ui/app-sync.ts` | Ciclo de vida de sync para la TUI y limpieza del runner al cerrar sesión. |

## Estructura de carpetas

| Carpeta o archivo | Responsabilidad actual |
| --- | --- |
| `todos/` | Acciones CLI y modelo de listas de tareas. Usa el factory compartido de listas. |
| `notes/` | Acciones CLI, modelo de listas de notas y prompt inline para contenido de nota. |
| `scrumban/` | Acciones CLI, modelo, render ASCII, listas de boards, columnas, cards y prioridad de cards. |
| `clocks/` | Acciones CLI y modelo de relojes guardados. Persiste en JSON directo. |
| `sync/` | Integración de `ilu` con sync: comandos, validación de remote, hooks, adapter, estado, cliente y runner para TUI. |
| `sync-core/` | Runtime reusable de sincronización local-first y su documentación propia. |
| `translate/` | Traducción de texto y proveedor Google Translate. |
| `tts/` | Conversión de `.txt` o `.md` a audio con OpenAI y merge de chunks con ffmpeg. |
| `ui/` | TUI con componentes, páginas, acciones por dominio y read model. |
| `utils/` | Utilidades compartidas: prompts, validación, paths locales, carga de DB, logging y factory de modelos de lista. |
| `tests/` | Pruebas con el runner de Node y `tsx`. Incluye helpers para HOME temporal y flujos funcionales. |
| `docs/diagrams/` | Diagramas generados o mantenidos para sync. |
| `docs/plans/` | Planes técnicos de trabajo. No son la fuente principal del estado actual. |

## Flujo CLI

1. El usuario ejecuta `ilu`.
2. `bin/cli.js` registra `tsx/cjs` y carga `cli.ts`.
3. `cli.ts` crea un `Command`, prepara dependencias por dominio y llama a `configureProgram()`.
4. `bin/configure-cli.ts` registra comandos y opciones.
5. Cada acción carga el módulo del dominio cuando se necesita.
6. El dominio ejecuta prompts, valida entrada, actualiza su modelo y muestra salida.
7. Los modelos que persisten datos disparan el hook de sync mediante `sync/ilu-hooks.ts`.

## Comandos registrados

| Comando | Alias | Módulo de acciones |
| --- | --- | --- |
| `ui` | | `ui/app.tsx` |
| `todo` | `t` | `todos/index.ts`, `todos/tasks.ts`, `todos/lists.ts` |
| `note` | `n` | `notes/index.ts`, `notes/notes.ts`, `notes/lists.ts` |
| `board` | `bd` | `scrumban/index.ts`, `scrumban/board.ts`, `scrumban/board-lists.ts` |
| `clock` | `c` | `clocks/index.ts`, `clocks/clocks.ts` |
| `sync` | | `sync/commands.ts` |
| `babel` | `b` | `translate/index.ts` |
| `tts` | | `tts/index.ts` |

## Modelos y persistencia

La carpeta local base se calcula en `utils/local-paths.ts` como `~/.ilu`.

Los archivos principales son:

- `~/.ilu/todos.json`
- `~/.ilu/notes.json`
- `~/.ilu/boards.json`
- `~/.ilu/clocks.json`
- `~/.ilu/.config/sync-config.json`
- `~/.ilu/.config/sync-state.json`
- `~/.ilu/.config/tts-config.json`

`utils/load-db.ts` configura `iludb` con el plugin JSON de Node y abre los modelos basados en archivo.

`todos/model.ts` y `notes/model.ts` usan `utils/create-list-model.ts`. Ese factory cubre listas activas, colecciones anidadas, etiquetas, reordenamiento básico, marcado de tareas y notificación de sync después de persistir.

`scrumban/model.ts` mantiene boards, columnas y cards. Los boards nuevos se crean con columnas default cuando no reciben columnas. Cada board guarda `defaultColumnId`, columnas con `id`, `title`, `wipLimit`, `cards` e índices normalizados.

`clocks/model.ts` lee y escribe `clocks.json` directamente con `fs`. Después de escribir, notifica sync con el dominio `clocks`.

## Prompts e interacción terminal

Los prompts compartidos viven en `utils/prompts.ts`. El módulo expone wrappers de:

- `input`
- `password`
- `number`
- `confirm`
- `select`
- `selectionList`
- `search`

Cada wrapper verifica que exista una terminal interactiva antes de abrir el prompt. Si no hay TTY, el comando termina con el mensaje `This command requires an interactive terminal (TTY). Piped or non-interactive stdin is not supported.`

Las selecciones por índice de tareas y notas viven en `utils/prompt-index-selection.ts`. Ese módulo construye labels con posición numérica y usa búsqueda para seleccionar uno o selección múltiple para seleccionar varios.

`notes/inline-note-prompt.ts` implementa el editor inline de contenido de nota. Sus teclas actuales son:

- `Enter` confirma.
- `Ctrl+N` agrega una nueva línea.
- `Shift+Enter` agrega una nueva línea si la terminal lo reporta.
- `Esc` cancela.
- `Ctrl+C` cancela con error de prompt interactivo.

La prioridad de boards y relojes usa dos pasos: primero búsqueda para elegir el elemento, después prompt numérico para elegir la posición destino.

Si cambias código que usa `@valyrianjs/terminal`, consulta primero la referencia local de la librería en `node_modules/@valyrianjs/terminal/llms-full.txt` después de instalar dependencias. Si necesitas confirmar detalles de implementación, revisa `node_modules/@valyrianjs/terminal/src`.

## Flujo de sync

La sincronización visible para usuario vive en `sync/commands.ts`:

- `init` valida remoto con `sync/remote-validation.ts`, guarda configuración, inspecciona bootstrap y prepara estado inicial.
- `status` imprime el estado actual.
- `retry` reintenta trabajo pendiente.
- `enable` y `disable` actualizan configuración y runtime.

`sync/remote-validation.ts` centraliza la regla compartida entre CLI y TUI: el remote no puede estar vacío y los remotes HTTP(S) no pueden incluir credenciales embebidas. La TUI reutiliza esa regla antes de llamar comandos para evitar que secretos terminen en config, logs o errores visibles.

La integración de dominio usa `sync/ilu-hooks.ts`. Los modelos llaman ese hook después de guardar, eliminar o cambiar el recurso activo. La TUI configura un runner propio con `sync/tui-sync-client.ts` para reaccionar a mutaciones locales sin hacer sincronización manual desde cada pantalla.

`sync-core/` contiene el runtime reusable. Su README propio documenta la API del core y sus límites.

## Flujo TUI

`ui/app.tsx` sigue como entrypoint real y centro de composición de la TUI:

1. Importa runtime terminal y `valyrian.js`.
2. Construye snapshots mediante `ui/app-snapshot.ts` y `ui/read-model.ts`.
3. Crea acciones por dominio desde `ui/modules/<module>/actions.ts` y usa opciones tipadas por IO para Sync, Translate y Speech.
4. Conecta el cliente de sync para TUI.
5. Compone shell, top nav, footer, overlays, paneles utilitarios y páginas.
6. Define tabs, ayuda por tab, estado inicial y acciones visibles. Los key bindings globales viven en `ui/app-keymap.ts`.

Las apps principales viven en `ui/modules/`:

- `ui/modules/todos/MainView.tsx`
- `ui/modules/notes/MainView.tsx`
- `ui/modules/board/MainView.tsx`
- `ui/modules/clocks/MainView.tsx`
- `ui/modules/sync/MainView.tsx`
- `ui/modules/babel/MainView.tsx`
- `ui/modules/tts/MainView.tsx`

Los componentes compartidos viven en `ui/components/`, incluyendo `AppShell`, `TopNav`, `Footer`, `ActionBar`, `Button`, `Overlay` y `EditOverlay`. `ui/components/utility` solo conserva utilidades compartidas reales.

## Traducción y TTS

`translate/index.ts` crea el traductor, valida que el texto no exceda 5000 caracteres, llama al proveedor y copia la traducción al portapapeles.

`tts/index.ts` valida extensiones `.txt` y `.md`, valida que la voz venga del catálogo soportado, resuelve o solicita API key, respeta la voz explícita de la llamada, divide textos largos, genera chunks de audio, los une con ffmpeg y limpia los chunks al terminar.

## Pruebas y typecheck

Los comandos verificados en `package.json` son:

```bash
npm test
npm run typecheck
```

`npm test` ejecuta:

```bash
node --import tsx --test
```

`npm run typecheck` ejecuta:

```bash
tsc --noEmit -p tsconfig.json
```

El repo usa un solo `tsconfig.json` raíz. Incluye archivos `.ts` y `.tsx`, excluye `node_modules`, `tmp`, `tests` y `**/*.test.ts`, y configura JSX con `valyrian.js`.

## Fuentes internas principales

- `package.json`: binario, scripts y dependencias runtime.
- `bin/cli.js`: bootstrap ejecutable.
- `cli.ts`: ejecutor real de CLI.
- `bin/configure-cli.ts`: comandos, aliases y opciones.
- `utils/local-paths.ts`: rutas locales.
- `utils/prompts.ts`: prompts compartidos.
- `utils/prompt-index-selection.ts`: selección por índice.
- `utils/create-list-model.ts`: factory de modelos de lista.
- `todos/model.ts`, `notes/model.ts`, `scrumban/model.ts`, `clocks/model.ts`: persistencia por dominio.
- `sync/commands.ts`: comandos de sync.
- `sync/remote-validation.ts`: validación compartida de remote para CLI y TUI.
- `ui/app.tsx`: entrypoint y composición de TUI.
- `ui/app-keymap.ts`: keymap global de TUI.
- `ui/app-snapshot.ts`: snapshots de TUI.
- `translate/index.ts`: traducción.
- `tts/index.ts`: texto a voz.
