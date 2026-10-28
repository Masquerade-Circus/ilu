# Contribuir a `ilu`

Esta guía resume el flujo práctico para trabajar en el repo sin mezclar documentación de usuario con detalles internos.

## Preparar el entorno

Instala dependencias:

```bash
npm install
```

Ejecuta la CLI desde el repo:

```bash
node bin/cli.js --help
```

Si necesitas probar el binario global desde este checkout:

```bash
npm link
ilu --help
```

## Antes de cambiar algo

Lee primero:

- [`README.md`](README.md), para entender el comportamiento visible para usuarios.
- [`docs/internal-architecture.md`](docs/internal-architecture.md), para ubicar entrypoints, carpetas, modelos, prompts, sync y TUI.
- [`sync-core/README.md`](sync-core/README.md), si tu cambio toca `sync-core/`.

## Verificaciones disponibles

Ejecuta la suite de pruebas:

```bash
npm test
```

Ejecuta el typecheck global:

```bash
npm run typecheck
```

Estos comandos están definidos en `package.json`.

### Capturas físicas de la TUI

Los casos `physical capture` se ejecutan con el runner Node existente. Un controlador TypeScript en Bun usa `@valyrianjs/terminal/testing` para abrir la CLI real en Node, con datos sintéticos, HOME privado y Sync desactivado. No reemplazan las comprobaciones funcionales headless.

La versión de terminal queda fijada en `0.2.15`. `postinstall` aplica una corrección localizada en `src/ansi.ts` y `dist/ansi.js`: al retirar el marcador del cursor, consulta solo el borde del control propietario y exige que el segmento incluya ese marcador. Sin esa corrección, un borde contenedor puede provocar una fila de 81 celdas sobre 80 columnas y borrar los controles de la fila siguiente. `support/patch-terminal.ts` valida la versión y el código esperado antes de escribir y admite ejecuciones repetidas. El archivo se incluye en el paquete para conservar la corrección tras una instalación normal. Si instalas con `--ignore-scripts`, ejecuta `npm run postinstall` explícitamente antes de usar ilu. Al actualizar terminal, revisa si el proveedor ya corrigió la causa y retira o adapta este parche.

```bash
node --import tsx --import ./support/test-home-guard.ts --test --test-concurrency=1 --test-name-pattern='^physical capture ' tests/ui-todo-notes-ui.test.ts tests/ui-app-board-layout.test.ts tests/ui-babel-tts-ui.test.ts tests/ui-app-shell.test.ts
```

Requieren Linux, Bun, GNOME Terminal/VTE, Xvfb, `dbus-run-session`, FFmpeg/ffprobe con soporte PNG y las bibliotecas `libX11.so.6` y `libXtst.so.6`. Si falta un requisito o falla una interacción, el test falla. No se omite ni se convierte en una captura reconstruida.

Cada caso conserva PNG de 1440×1000 píxeles y logs bajo `tmp/terminal-captures/case-*/run-*/`. El test imprime las rutas. El directorio padre conserva `request.json`, `response.json` y los logs del controlador. Si falla el recorrido, se intenta guardar `scenario-failure.png` antes del cleanup. Los artefactos permanecen disponibles para inspección incluso si falla el test.

Abre los PNG para revisar colores, foco, recortes y superposiciones. La proyección textual del PTY solo sirve para las interacciones y afirmaciones funcionales. Mantiene cursor, borrados y tamaños sucesivos, admite los textos de una celda usados por los fixtures y rechaza secuencias desconocidas. No certifica los píxeles ni pretende reemplazar un emulador VT general.

El backend cierra exclusivamente los grupos de recursos propios registrados, con SIGTERM y posible SIGKILL tras 150 ms, también ante errores de arranque. El runner Node y el controlador Bun externo terminan por su flujo normal, sin señales de este puente. Una ejecución automatizada necesita permiso para ese cleanup. Se conservan los archivos generados, sin usar credenciales ni datos personales.

## Flujo recomendado

1. Identifica si el cambio afecta CLI, TUI, modelos, sync, traducción, TTS o documentación.
2. Revisa el archivo de dominio correspondiente antes de editar.
3. Mantén las pruebas aisladas del `HOME` real usando los helpers existentes de `tests/` cuando agregues cobertura.
4. Actualiza `README.md` solo cuando cambie el uso visible para usuarios.
5. Actualiza `docs/internal-architecture.md` cuando cambie la organización interna actual del código.
6. Ejecuta `npm test` o el subset relevante y `npm run typecheck` cuando el cambio lo requiera.

## Documentación

El README debe responder cómo se usa `ilu`. Evita convertirlo en un documento de arquitectura interna.

La documentación interna debe describir el estado actual del código y las rutas que un contributor necesita para ubicarse.

## Cambios en prompts o TUI

Los prompts compartidos están en `utils/prompts.ts`. La TUI vive en `ui/` y su entrypoint real es `ui/app.tsx`.

Si cambias código que usa `@valyrianjs/terminal`, revisa la referencia local después de instalar dependencias:

```text
node_modules/@valyrianjs/terminal/llms-full.txt
```

Cuando necesites confirmar detalles de implementación de esa librería, revisa `node_modules/@valyrianjs/terminal/src` como fuente primaria.

## Datos locales durante pruebas manuales

`ilu` guarda datos en `~/.ilu/`. Ten cuidado al hacer pruebas manuales si usas tu instalación personal.

Para pruebas automatizadas, usa los patrones existentes de `tests/` y `support/home-sandbox.ts` para evitar tocar el `HOME` real.
