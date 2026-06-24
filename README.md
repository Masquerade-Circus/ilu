# ilu

`ilu` es una CLI de productividad personal para trabajar desde la terminal. Permite administrar tareas, notas, tableros, relojes guardados, traducciones, texto a voz y sincronización local con un remoto Git.

## Instalación

Desde este repositorio:

```bash
npm install
node bin/cli.js --help
```

Para exponer el comando `ilu` globalmente desde el repo:

```bash
npm install -g .
```

También puedes usar:

```bash
npm link
```

Verifica la instalación con:

```bash
ilu --version
ilu --help
```

## Uso rápido

```bash
ilu <command> [options]
```

Comandos principales:

| Comando | Alias | Para qué sirve |
| --- | --- | --- |
| `ui` | | Abre el workspace interactivo en terminal |
| `todo` | `t` | Administra tareas y listas de tareas |
| `note` | `n` | Administra notas y listas de notas |
| `board` | `bd` | Administra tableros, columnas y cards |
| `clock` | `c` | Administra relojes guardados |
| `sync` | | Sincroniza datos locales con un remoto Git |
| `babel` | `b` | Traduce texto y copia el resultado al portapapeles |
| `tts` | | Convierte archivos `.txt` o `.md` a audio |

Los comandos de listas, notas, tareas, boards y relojes muestran el contenido actual cuando se ejecutan sin opciones.

## Workspace interactivo

```bash
ilu ui
```

El workspace abre una interfaz de terminal para trabajar con Todo, Notes, Board, Clocks, Sync, Translate y Speech desde una misma sesión.

Atajos visibles en la interfaz:

- Usa flechas para moverte en listas, notas, cards y relojes.
- Usa `Enter` o `Space` para activar la acción principal cuando la vista lo indique.
- Usa `Shift` más flechas para reordenar donde la vista lo indique.
- Usa las acciones visibles en pantalla para crear, editar, mover, eliminar, traducir, copiar o convertir.
- En overlays secundarios, `Esc` cierra la vista actual.
- En campos de entrada, `Ctrl+C` copia cuando el campo lo permite. Fuera de entradas, `Ctrl+C` cancela o sale.

## Tareas

```bash
ilu todo
ilu todo --add
ilu todo --check
ilu todo --details
ilu todo --edit
ilu todo --remove
```

También puedes administrar listas de tareas:

```bash
ilu todo --lists
ilu todo --use-list
ilu todo --add-list
ilu todo --edit-list
ilu todo --remove-list
```

Cómo se usa:

- `ilu todo` muestra las tareas de la lista activa.
- `--add` pide título y descripción.
- `--check` permite marcar o desmarcar tareas terminadas.
- `--details`, `--edit` y `--remove` abren una selección interactiva.
- Las selecciones muestran posiciones numéricas junto al título para que identifiques cada elemento.

## Notas

```bash
ilu note
ilu note --add
ilu note --details
ilu note --edit
ilu note --remove
```

También puedes administrar listas de notas:

```bash
ilu note --lists
ilu note --use-list
ilu note --add-list
ilu note --edit-list
ilu note --remove-list
```

Cómo se usa:

- `ilu note` muestra las notas de la lista activa.
- `--add` pide el título y luego abre un prompt inline para escribir el contenido.
- En el prompt inline de contenido, `Enter` confirma, `Ctrl+N` agrega una nueva línea y `Esc` cancela.
- `--details`, `--edit` y `--remove` abren una selección interactiva.

## Boards

```bash
ilu board
ilu board --add
ilu board --details
ilu board --edit
ilu board --move
ilu board --priority
ilu board --remove
ilu board --columns
```

También puedes administrar tableros:

```bash
ilu board --list-boards
ilu board --use-board
ilu board --add-board
ilu board --edit-board
ilu board --remove-board
```

Los atajos `-ab`, `-eb` y `-rb` también funcionan para agregar, editar y eliminar tableros.

Cómo se usa:

- `ilu board` muestra el tablero activo.
- `--add` crea una card en la columna default del tablero.
- `--move` permite seleccionar una o varias cards y elegir la columna destino.
- `--priority` permite elegir una card dentro de una columna y moverla a otra posición numérica.
- `--columns` permite agregar columnas, renombrarlas, moverlas, establecer WIP limit, cambiar la columna default o resetear columnas vacías al default simple.
- Las cards se seleccionan con búsqueda o selección múltiple según la acción.

Los boards nuevos usan estas columnas iniciales cuando no se eligen columnas personalizadas: `Backlog`, `Ready`, `In Progress` y `Done`.

## Relojes

```bash
ilu clock
ilu clock --add
ilu clock --priority
ilu clock --remove
ilu clock --remove 2
```

Cómo se usa:

- `ilu clock` muestra los relojes guardados.
- `--add` abre una búsqueda de zonas horarias y después pide un nombre.
- `--priority` permite elegir un reloj y moverlo a otra posición numérica.
- `--remove <position>` elimina el reloj de esa posición.
- `--remove` sin posición abre una selección múltiple.

Cada reloj usa una zona horaria IANA, por ejemplo `America/Mexico_City` o `Etc/UTC`.

## Sincronización

```bash
ilu sync init --remote <url> [--branch main]
ilu sync status
ilu sync retry
ilu sync enable
ilu sync disable
```

Cómo se usa:

- `sync init` configura la sincronización con un remoto Git y usa `main` como branch por default.
- `sync status` muestra el estado actual.
- `sync retry` reintenta trabajo pendiente.
- `sync enable` y `sync disable` activan o desactivan la sincronización local.

La sincronización es local-first: los datos locales se guardan antes del trabajo remoto. Si la sincronización remota falla, los datos locales permanecen en disco.

`ilu` sincroniza estos archivos de datos bajo `~/.ilu/`:

- `todos.json`
- `notes.json`
- `boards.json`
- `clocks.json`

La carpeta `~/.ilu/.config/` guarda configuración local y estado runtime. No forma parte de los datos sincronizados.

## Traducción

```bash
ilu babel <text...>
ilu b <text...>
```

Opciones:

- `--source [source]`: idioma origen. El default es `auto`.
- `--target [target]`: idioma destino. El default sale del idioma del sistema.

El resultado traducido se imprime en terminal y se copia al portapapeles.

## Texto a voz

```bash
ilu tts <inputFile> <outputFile>
ilu tts voice
```

Cómo se usa:

- El archivo de entrada debe terminar en `.txt` o `.md`.
- `ilu tts voice` abre un selector de voz y guarda la voz default.
- Si no hay API key guardada, el comando la pide de forma interactiva.
- Los textos largos se dividen en partes antes de generar el audio.
- Si una generación se interrumpe, el mensaje de error incluye el comando de reintento.

La configuración de TTS se guarda en `~/.ilu/.config/tts-config.json`.

## Datos locales

`ilu` guarda datos y configuración bajo:

```text
~/.ilu/
```

Archivos de datos actuales:

- `~/.ilu/todos.json`
- `~/.ilu/notes.json`
- `~/.ilu/boards.json`
- `~/.ilu/clocks.json`

Archivos de configuración y estado actuales:

- `~/.ilu/.config/sync-config.json`
- `~/.ilu/.config/sync-state.json`
- `~/.ilu/.config/tts-config.json`

## Prompts interactivos

Los comandos que crean, editan o seleccionan datos necesitan una terminal interactiva. Si un comando interactivo se ejecuta sin TTY, `ilu` termina con un error claro en lugar de mostrar un stack trace del prompt.

En prompts de selección:

- Escribe para filtrar cuando la selección use búsqueda.
- Usa la posición numérica visible para identificar elementos en acciones de prioridad.
- En selecciones múltiples, elige al menos un elemento cuando el prompt lo pida.

## Para contribuir

La documentación interna vive en [`docs/internal-architecture.md`](docs/internal-architecture.md) y la guía práctica de contribución vive en [`CONTRIBUTING.md`](CONTRIBUTING.md).
