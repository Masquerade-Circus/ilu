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

La versión de terminal queda fijada en `0.2.16`. Esta versión incorpora la corrección del renderer que evita confundir el borde contenedor con el del control y exige consumir el marcador del cursor sin ampliar la fila. El parche local de `0.2.15` y su hook `postinstall` se retiraron porque la corrección ya pertenece al proveedor. Las capturas conservan GNOME Terminal como backend predeterminado. El soporte upstream de Kitty y WezTerm es opcional y no implica que estén instalados ni que los atajos funcionen en todos los emuladores.

```bash
node --import tsx --import ./support/test-home-guard.ts --test --test-concurrency=1 --test-name-pattern='^physical capture ' tests/ui-todo-notes-ui.test.ts tests/ui-app-board-layout.test.ts tests/ui-babel-tts-ui.test.ts tests/ui-app-shell.test.ts
```

Requieren Linux, Bun, GNOME Terminal/VTE, Xvfb, `dbus-run-session`, FFmpeg/ffprobe con soporte PNG, x11grab y H.264, y las bibliotecas `libX11.so.6` y `libXtst.so.6`. Si falta un requisito o falla una interacción, el test falla. No se omite ni se convierte en una captura reconstruida.

Cada caso publica sus PNG de 1440×1000 píxeles, un MP4 y los diagnósticos directamente en `tmp/terminal-captures/`, sin nuevas subcarpetas ni IDs aleatorios. El nombre real del test se convierte a minúsculas, con guiones como separadores. Los PNG usan `<nombre-del-test>-1.png`, `<nombre-del-test>-2.png`, etc., según el orden de captura. El video usa `<nombre-del-test>.mp4`. Los diagnósticos usan el mismo prefijo, por ejemplo `<nombre-del-test>.actions.json`, `<nombre-del-test>.terminal-output.bin` y `<nombre-del-test>.controller.stderr.log`. Cada ejecución reemplaza los archivos del mismo nombre y reinicia el consecutivo en uno. El test imprime las rutas y comprueba la validez y decodificación completa del MP4.

El HOME y los recursos privados del backend permanecen separados, bajo `tmp/terminal-capture-workspaces/case-*/run-*/`. No se borran históricos ni archivos ajenos. Si falla el recorrido, se intenta tomar una captura de error con el siguiente consecutivo. El cierre y la publicación conservan los diagnósticos y capturas disponibles también ante errores.

Abre los PNG para revisar colores, foco, recortes y superposiciones. La proyección textual del PTY solo sirve para las interacciones y afirmaciones funcionales. Mantiene cursor, borrados y tamaños sucesivos, admite los textos de una celda usados por los fixtures y rechaza secuencias desconocidas. No certifica los píxeles ni pretende reemplazar un emulador VT general.

El controlador delega la grabación y su finalización a `launchTerminal({video: "on"})` y `close()` de `@valyrianjs/terminal/testing`. Publica el MP4 después de ese cierre, sin implementar otro control de FFmpeg. El backend cierra exclusivamente los grupos de recursos propios registrados, con SIGTERM y posible SIGKILL tras 150 ms, también ante errores de arranque. El runner Node y el controlador Bun externo terminan por su flujo normal, sin señales de este puente. Una ejecución automatizada necesita permiso para ese cleanup, incluido el grabador de video. Se conservan los archivos generados, sin usar credenciales ni datos personales.

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
