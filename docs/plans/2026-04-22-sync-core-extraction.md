# Sync Core Extraction Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Separar el subsistema de sync en un `sync-core` reusable que sincronice una carpeta mediante `sourceRoot + ignorePatterns`, dejando a `ilu` como consumidor y al CLI como capa aparte.

**Architecture:** La extracción debe preservar comportamiento primero y rediseñar contratos después. El `core` concentrará máquina de estados, runtime y backend Git reusable; `ilu` seguirá resolviendo paths, config, ignore patterns y hooks de mutación; `sync/commands.js` seguirá siendo la frontera CLI.

**Tech Stack:** Node.js CommonJS, node:test, Commander, Git CLI.

---

## Contexto repo-first

**Archivos observados clave**
- Core actual parcial: `sync/engine.js`, `sync/machine.js`, `sync/git-cli-backend.js`, `sync/contracts.js`
- Consumer `ilu`: `sync/index.js`, `sync/ilu-adapter.js`, `sync/state-store.js`, `sync/ilu-hooks.js`, `utils/local-paths.js`, `utils/config-store.js`
- CLI: `sync/commands.js`, `bin/cli.js`, `bin/configure-cli.js`
- Integración desde dominio: `utils/create-list-model.js`, `scrumban/model.js`, `clocks/model.js`
- Tests: `tests/sync-engine.test.js`, `tests/sync-machine.test.js`, `tests/sync-git-cli-backend.test.js`, `tests/sync-state-store.test.js`, `tests/sync-ilu-adapter.test.js`, `tests/sync-*.command.test.js`, `tests/sync-*.hook.test.js`, `tests/sync-local-remote.integration.test.js`

**Decisión estructural ya tomada**
- `sync-core` vive en el mismo repo por ahora.
- `ilu` será consumidor del core.
- El contrato del core migra de `listTrackedEntries()` a `sourceRoot + ignorePatterns`.

---

### Task 1: Crear el esqueleto físico de `sync-core`

**Files:**
- Create: `sync-core/engine.js`
- Create: `sync-core/machine.js`
- Create: `sync-core/contracts.js`
- Modify: `sync/engine.js`
- Modify: `sync/machine.js`
- Modify: `sync/contracts.js`
- Test: `tests/sync-engine.test.js`
- Test: `tests/sync-machine.test.js`

**Step 1: Write the failing test**

Actualizar `tests/sync-engine.test.js` y `tests/sync-machine.test.js` para cargar primero desde `sync-core/...`.

Ejemplo mínimo:

```js
const coreEnginePath = path.join(repoRoot, 'sync-core', 'engine.js');
const coreMachinePath = path.join(repoRoot, 'sync-core', 'machine.js');
```

**Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/sync-engine.test.js tests/sync-machine.test.js
```

Expected: FAIL porque `sync-core/engine.js` y `sync-core/machine.js` todavía no existen.

**Step 3: Write minimal implementation**

- Copiar `sync/engine.js` a `sync-core/engine.js` sin cambiar comportamiento.
- Copiar `sync/machine.js` a `sync-core/machine.js` sin cambiar comportamiento.
- Mover a `sync-core/contracts.js` solo el contrato genérico de host/backend.
- Dejar `sync/engine.js`, `sync/machine.js` y `sync/contracts.js` como re-exports temporales hacia `sync-core/*`.

Ejemplo:

```js
module.exports = require('../sync-core/engine');
```

**Step 4: Run test to verify it passes**

Run:

```bash
node --test tests/sync-engine.test.js tests/sync-machine.test.js
```

Expected: PASS.

**Step 5: Commit**

```bash
git add sync-core/engine.js sync-core/machine.js sync-core/contracts.js sync/engine.js sync/machine.js sync/contracts.js tests/sync-engine.test.js tests/sync-machine.test.js
git commit -m "refactor: extract sync core runtime modules"
```

**Success criteria**
- El runtime y la máquina ya tienen frontera física propia.
- No cambia comportamiento observable del CLI ni de tests existentes.

---

### Task 2: Convertir `sync/index.js` en composition root de consumidor

**Files:**
- Modify: `sync/index.js`
- Modify: `sync/ilu-adapter.js`
- Test: `tests/sync-ilu-adapter.test.js`
- Test: `tests/sync-engine.test.js`

**Step 1: Write the failing test**

Agregar una prueba que verifique que `sync/index.js` compone el runtime usando `sync-core/engine.js` y dependencias del consumidor.

Ejemplo:

```js
assert.equal(typeof createSyncRuntime, 'function');
assert.equal(typeof notifyLocalMutation, 'function');
```

**Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/sync-ilu-adapter.test.js tests/sync-engine.test.js
```

Expected: FAIL si la prueba inspecciona el nuevo boundary y `sync/index.js` sigue acoplado a rutas viejas.

**Step 3: Write minimal implementation**

- Cambiar `sync/index.js` para importar `createSyncRuntime` desde `../sync-core/engine`.
- Mantener el singleton solo aquí.
- Dejar `sync/ilu-adapter.js` como proveedor del consumidor (`getSyncConfig`, `getSourceRoot`, `buildCommitMessage`, `getStateStore`).
- No mover todavía lógica de CLI ni hooks.

**Step 4: Run test to verify it passes**

Run:

```bash
node --test tests/sync-ilu-adapter.test.js tests/sync-engine.test.js
```

Expected: PASS.

**Step 5: Commit**

```bash
git add sync/index.js sync/ilu-adapter.js tests/sync-ilu-adapter.test.js tests/sync-engine.test.js
git commit -m "refactor: compose sync runtime from ilu consumer"
```

**Success criteria**
- `sync-core` no depende de paths/config de `ilu`.
- El singleton global queda confinado al consumidor.

---

### Task 3: Extraer el backend Git reusable y aislar la policy de ignore

**Files:**
- Create: `sync-core/backends/git-cli.js`
- Modify: `sync/git-cli-backend.js`
- Test: `tests/sync-git-cli-backend.test.js`

**Step 1: Write the failing test**

Agregar pruebas separadas para dos comportamientos:
- clasificación de errores Git reusable;
- policy de ignore definida por consumer, no hardcodeada en backend.

Ejemplo:

```js
assert.equal(classifyGitError(new Error('Authentication failed')).kind, 'auth');
```

**Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/sync-git-cli-backend.test.js
```

Expected: FAIL mientras `.config/` siga hardcodeado en el backend reusable.

**Step 3: Write minimal implementation**

- Mover el backend reusable a `sync-core/backends/git-cli.js`.
- Cambiar `sync/git-cli-backend.js` a re-export temporal o wrapper del consumer.
- Reemplazar `ensureIgnoreFile()` hardcodeado por una entrada configurable, por ejemplo `ignorePatterns` o `ignoredEntries`.
- Mantener `classifyGitError()` estable.

**Step 4: Run test to verify it passes**

Run:

```bash
node --test tests/sync-git-cli-backend.test.js
```

Expected: PASS.

**Step 5: Commit**

```bash
git add sync-core/backends/git-cli.js sync/git-cli-backend.js tests/sync-git-cli-backend.test.js
git commit -m "refactor: extract reusable git sync backend"
```

**Success criteria**
- El backend reusable ya no conoce `.config/` ni archivos de `ilu`.
- La política de ignore viene del consumidor.

---

### Task 4: Cambiar el contrato del core a `sourceRoot + ignorePatterns`

**Files:**
- Modify: `sync-core/contracts.js`
- Modify: `sync-core/engine.js`
- Modify: `sync-core/backends/git-cli.js`
- Modify: `sync/ilu-adapter.js`
- Test: `tests/sync-engine.test.js`
- Test: `tests/sync-git-cli-backend.test.js`
- Test: `tests/sync-ilu-adapter.test.js`

**Step 1: Write the failing test**

Reemplazar en `tests/sync-engine.test.js` el harness de `listTrackedEntries()` por `getIgnorePatterns()`.

Ejemplo:

```js
getIgnorePatterns() {
  return ['.config/**'];
}
```

Actualizar asserts del backend para esperar:

```js
syncWorkingTree({sourceRoot: '/tmp/source', ignorePatterns: ['.config/**']})
```

**Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/sync-engine.test.js tests/sync-git-cli-backend.test.js tests/sync-ilu-adapter.test.js
```

Expected: FAIL porque el core todavía usa `listTrackedEntries()`.

**Step 3: Write minimal implementation**

- Cambiar contrato de host de `listTrackedEntries` a `getIgnorePatterns`.
- Hacer que `engine` pase `sourceRoot + ignorePatterns` al backend.
- Hacer que el consumer `ilu` regrese ignores como `['.config/**']` y cualquier patrón adicional documentado.
- Preservar `buildCommitMessage(context)` como responsabilidad del consumidor.

**Step 4: Run test to verify it passes**

Run:

```bash
node --test tests/sync-engine.test.js tests/sync-git-cli-backend.test.js tests/sync-ilu-adapter.test.js
```

Expected: PASS.

**Step 5: Commit**

```bash
git add sync-core/contracts.js sync-core/engine.js sync-core/backends/git-cli.js sync/ilu-adapter.js tests/sync-engine.test.js tests/sync-git-cli-backend.test.js tests/sync-ilu-adapter.test.js
git commit -m "refactor: switch sync core to folder and ignore patterns"
```

**Success criteria**
- El core ya sincroniza carpeta + reglas de ignore.
- Ninguna pieza del core conoce `todos.json`, `notes.json`, `boards.json` o `clocks.json`.

---

### Task 5: Aislar el state store reusable del state store de `ilu`

**Files:**
- Create: `sync-core/state/file-store.js` (optional helper)
- Modify: `sync/state-store.js`
- Modify: `sync/index.js`
- Test: `tests/sync-state-store.test.js`
- Test: `tests/sync-engine.test.js`

**Step 1: Write the failing test**

Agregar prueba que verifique que el core solo necesita `loadState/saveState`, no `local-paths`.

Ejemplo:

```js
assert.equal(typeof stateStore.loadState, 'function');
assert.equal(typeof stateStore.saveState, 'function');
```

**Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/sync-state-store.test.js tests/sync-engine.test.js
```

Expected: FAIL si el test nuevo intenta usar un store genérico y el core sigue dependiendo del store de `ilu`.

**Step 3: Write minimal implementation**

- Mantener en `sync/state-store.js` el wrapper específico de `ilu` con `local-paths`.
- Opcionalmente crear `sync-core/state/file-store.js` si ayuda a tests y futuro reuso.
- Asegurar que `sync-core/engine.js` solo reciba `stateStore` inyectado.

**Step 4: Run test to verify it passes**

Run:

```bash
node --test tests/sync-state-store.test.js tests/sync-engine.test.js
```

Expected: PASS.

**Step 5: Commit**

```bash
git add sync-core/state/file-store.js sync/state-store.js sync/index.js tests/sync-state-store.test.js tests/sync-engine.test.js
git commit -m "refactor: isolate ilu sync state store from core"
```

**Success criteria**
- El core ya no importa `utils/local-paths`.
- `sync/state-store.js` queda explícitamente como concern del consumidor.

---

### Task 6: Mantener CLI separado y reenfocar `init` al consumidor

**Files:**
- Modify: `sync/commands.js`
- Modify: `sync/index.js`
- Test: `tests/sync-init-command.test.js`
- Test: `tests/sync-retry-command.test.js`
- Test: `tests/sync-status-command.test.js`

**Step 1: Write the failing test**

Agregar prueba que verifique que `sync/commands.js` usa al consumidor y no importa módulos internos del core fuera del composition root necesario.

**Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/sync-init-command.test.js tests/sync-retry-command.test.js tests/sync-status-command.test.js
```

Expected: FAIL si `commands.js` sigue tocando detalles del core directamente.

**Step 3: Write minimal implementation**

- Dejar `init/status/retry/enable/disable` en `sync/commands.js`.
- Hacer que `commands.js` dependa del composition root consumidor y del config store de `ilu`, no del core directo salvo el backend reusable si de verdad es necesario para bootstrap.
- Mantener `init` fuera del core en esta etapa.

**Step 4: Run test to verify it passes**

Run:

```bash
node --test tests/sync-init-command.test.js tests/sync-retry-command.test.js tests/sync-status-command.test.js
```

Expected: PASS.

**Step 5: Commit**

```bash
git add sync/commands.js sync/index.js tests/sync-init-command.test.js tests/sync-retry-command.test.js tests/sync-status-command.test.js
git commit -m "refactor: keep sync cli commands outside core"
```

**Success criteria**
- El CLI sigue funcionando sin conocer los detalles internos del core.
- `init` sigue siendo policy de consumidor/CLI, no del runtime reusable.

---

### Task 7: Reenrutar hooks de modelos al consumidor sin tocar dominio

**Files:**
- Modify: `sync/ilu-hooks.js`
- Modify: `utils/create-list-model.js`
- Modify: `scrumban/model.js`
- Modify: `clocks/model.js`
- Test: `tests/sync-list-model-hook.test.js`
- Test: `tests/sync-board-hook.test.js`
- Test: `tests/sync-clock-hook.test.js`

**Step 1: Write the failing test**

Agregar assertions que verifiquen que los modelos notifican al consumidor de sync, no al core directamente.

**Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/sync-list-model-hook.test.js tests/sync-board-hook.test.js tests/sync-clock-hook.test.js
```

Expected: FAIL si los imports todavía quedan cruzados a rutas viejas o al core.

**Step 3: Write minimal implementation**

- Mantener la llamada `notifySync({domain, action})` como contrato del consumidor.
- No mover lógica de dominio a `sync-core`.
- Solo reenrutar imports y asegurar que el runtime consumidor se usa como única salida.

**Step 4: Run test to verify it passes**

Run:

```bash
node --test tests/sync-list-model-hook.test.js tests/sync-board-hook.test.js tests/sync-clock-hook.test.js
```

Expected: PASS.

**Step 5: Commit**

```bash
git add sync/ilu-hooks.js utils/create-list-model.js scrumban/model.js clocks/model.js tests/sync-list-model-hook.test.js tests/sync-board-hook.test.js tests/sync-clock-hook.test.js
git commit -m "refactor: route ilu model sync through consumer hooks"
```

**Success criteria**
- Ningún modelo importa `sync-core`.
- El dominio conserva su comportamiento actual de notificación.

---

### Task 8: Correr verificación completa y limpiar compatibilidad temporal

**Files:**
- Modify: `sync/engine.js`
- Modify: `sync/machine.js`
- Modify: `sync/contracts.js`
- Modify: `sync/git-cli-backend.js`
- Optional: `sync/diagram.js`
- Optional: `sync/generate-diagrams.js`
- Test: `tests/**/*.test.js`

**Step 1: Write the failing test**

Agregar o ajustar pruebas de integración que validen explícitamente que `ilu` sigue sincronizando correctamente después de la extracción.

Punto mínimo:

```js
assert.equal(status.status, 'healthy');
```

**Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/sync-local-remote.integration.test.js tests/functional-flows.test.js
```

Expected: FAIL si los re-exports o boundaries temporales todavía esconden imports incorrectos.

**Step 3: Write minimal implementation**

- Eliminar re-exports temporales si ya no son necesarios.
- Corregir imports finales a `sync-core/*` o al consumer según corresponda.
- Reubicar tooling de diagramas solo si estorba el boundary; no ampliar scope si no hace falta.

**Step 4: Run test to verify it passes**

Run:

```bash
node --test
```

Expected: PASS completo.

**Step 5: Commit**

```bash
git add sync-core sync tests
git commit -m "refactor: finalize sync core extraction"
```

**Success criteria**
- Todos los tests pasan.
- `sync-core` ya no depende de `ilu`.
- `ilu` consume el core mediante composition root claro.
- CLI, hooks y paths permanecen fuera del core.

---

## Riesgos a vigilar durante la implementación

1. **Sobre-sincronizar archivos** al migrar de entries explícitos a carpeta completa.
2. **Volver a meter policy de `ilu` en el backend reusable**.
3. **Romper bootstrap de `init`** al separar runtime y CLI.
4. **Dejar imports cruzados** desde dominio/consumer hacia `sync-core`.
5. **Cambiar comportamiento demasiado pronto** en vez de primero mover boundaries.

## Verificación final requerida

Run:

```bash
node --test tests/sync-engine.test.js tests/sync-machine.test.js tests/sync-git-cli-backend.test.js tests/sync-state-store.test.js tests/sync-ilu-adapter.test.js tests/sync-init-command.test.js tests/sync-retry-command.test.js tests/sync-status-command.test.js tests/sync-list-model-hook.test.js tests/sync-board-hook.test.js tests/sync-clock-hook.test.js tests/sync-local-remote.integration.test.js
```

Luego:

```bash
node --test
```

Expected:
- PASS en pruebas unitarias de core
- PASS en pruebas del consumidor `ilu`
- PASS en pruebas de CLI
- PASS en integración local/remote
