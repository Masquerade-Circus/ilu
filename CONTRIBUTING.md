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
