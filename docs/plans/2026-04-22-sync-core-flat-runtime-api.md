# Sync Core Flat Runtime API Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactorizar `sync-core` para que la API pública principal de `createSyncRuntime()` sea plana y centrada en configuración de uso común, ocultando `stateStore` y `backend` detrás de defaults internos.

**Architecture:** El refactor debe mover la composición de dependencias internas al propio `sync-core`, dejando `createSyncRuntime()` como entrypoint público principal con firma plana. La compatibilidad temporal, si se mantiene, debe vivir solo dentro del core y desaparecer de la documentación pública. La extensibilidad avanzada debe quedar separada en una segunda fase para no contaminar la API principal.

**Tech Stack:** Node.js CommonJS, `node:test`, Git CLI backend, filesystem local.

---

## Contexto repo-first

**Hallazgos observados**
- La firma actual del core todavía exige `{adapter, stateStore, backend}` en `sync-core/engine.js:45-48`.
- El runtime ya obtiene `sourceRoot`, `ignorePatterns` y `buildCommitMessage()` vía `adapter` en `sync-core/engine.js:77-92`; esos datos ya existen y se pueden promover a la API plana.
- El backend reusable ya existe en `sync-core/backends/git-cli.js:74-244`.
- El state store reusable ya existe en `sync-core/state/file-store.js:4-47`.
- El consumer `ilu` hoy funciona como composition root en `sync/index.js:40-55`, donde arma backend y state store por fuera del core.
- El adapter del consumer ya conoce `sourceRoot`, `ignorePatterns`, `buildCommitMessage` y config de sync en `sync/ilu-adapter.js:5-35`.
- La cobertura actual relevante está en `tests/sync-engine.test.js`, `tests/sync-git-cli-backend.test.js`, `tests/sync-state-store.test.js`, `tests/sync-ilu-adapter.test.js` y `tests/sync-local-remote.integration.test.js`.

**Supuestos explícitos**
- `sync-core` seguirá siendo reusable dentro del repo, pero la API pública principal será la nueva firma plana ya decidida.
- El backend por default seguirá siendo el backend Git CLI existente.
- El state store por default seguirá siendo un file store local, pero parametrizado desde datos de la API plana en vez de exigirse como dependencia pública.
- La compatibilidad anterior, si se deja, será temporal, privada y solo para facilitar una migración en dos pasos.

**Definition of done de este refactor**
- `createSyncRuntime()` acepta la firma plana acordada.
- El flujo normal ya no requiere pasar `adapter`, `stateStore` ni `backend`.
- `sourceRoot` e `ignorePatterns` viven en la API pública principal.
- Los defaults internos de backend y state store se resuelven dentro de `sync-core`.
- Existe cobertura de tests para la nueva superficie pública, la compatibilidad temporal y la composición interna por default.
- La documentación de `sync-core` deja de presentar la integración principal como composición manual.

---

## Secuencia mínima recomendada

1. Introducir pruebas del nuevo contrato plano sin borrar todavía la ruta anterior.
2. Extraer dentro de `sync-core` una capa pequeña de normalización/composición de opciones.
3. Hacer que `createSyncRuntime()` use esa composición interna y siga funcionando con el runtime actual.
4. Migrar `sync/index.js` para consumir la API plana.
5. Ajustar integración, docs y compatibilidad temporal.
6. Solo después evaluar/agregar `createSyncRuntimeAdvanced()` como API separada.

---

## Estrategia TDD global

Aplicar Red -> Green -> Refactor en este orden:

1. **Contrato público del core**
   - primero fallan tests que expresan la nueva firma plana;
   - luego pasa con un shim mínimo que compone internamente las dependencias actuales.

2. **Defaults internos**
   - primero fallan tests que exigen backend/state store implícitos;
   - luego se implementa la factoría interna mínima.

3. **Consumer `ilu`**
   - primero fallan tests del composition root para confirmar que ya no inyecta `stateStore`/`backend` en el camino normal;
   - luego se migra `sync/index.js`.

4. **Compatibilidad temporal**
   - primero fallan tests que confirman que el shape anterior todavía entra por una ruta privada de compatibilidad;
   - luego se añade el adaptador transitorio.

5. **Integración y docs**
   - al final se ajustan integración y README cuando el contrato ya está estable.

---

### Task 1: Congelar el nuevo contrato público en tests del core

**Files:**
- Modify: `tests/sync-engine.test.js`
- Optional modify: `tests/sync-local-remote.integration.test.js`

**Objetivo**
Hacer explícito en tests que la API pública principal ya no recibe `{adapter, stateStore, backend}` sino la firma plana acordada.

**Step 1: Write the failing test**

Agregar casos nuevos en `tests/sync-engine.test.js` para cubrir, como mínimo:

```js
const runtime = createSyncRuntime({
  enabled: true,
  remoteUrl: '/tmp/remote.git',
  branch: 'main',
  autoSync: false,
  autoPull: true,
  autoPush: true,
  sourceRoot: '/tmp/source',
  ignorePatterns: ['.config/**'],
  buildCommitMessage() {
    return 'sync(todos): save local data snapshot';
  }
});
```

Asserts mínimos:
- no lanza por faltar `adapter/stateStore/backend`;
- `notifyLocalMutation()` sigue llamando `syncWorkingTree({sourceRoot, ignorePatterns})`;
- `commit()` usa `buildCommitMessage(context)`;
- `getSyncStatus()` arranca con estado coherente.

Agregar además un test negativo que exija error claro cuando `enabled === true` y falta `remoteUrl`.

**Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/sync-engine.test.js
```

Expected: FAIL porque `sync-core/engine.js` todavía exige `{adapter, stateStore, backend}`.

**Step 3: Write minimal implementation**

Todavía no tocar lógica de runtime; solo preparar los asserts y helpers de test para la nueva forma plana.

**Step 4: Run test to verify red state is real**

Run:

```bash
node --test tests/sync-engine.test.js
```

Expected: FAIL en los tests nuevos y PASS en el resto existente.

**Success criteria**
- El contrato objetivo queda congelado en pruebas antes de cambiar implementación.

---

### Task 2: Introducir normalización interna de opciones y compatibilidad temporal privada

**Files:**
- Create: `sync-core/runtime-options.js` *(o nombre equivalente dedicado a normalización/composición)*
- Modify: `sync-core/engine.js`
- Modify: `tests/sync-engine.test.js`

**Objetivo**
Separar de `engine.js` la decisión “API plana nueva vs shape anterior temporal” para que el runtime quede limpio.

**Step 1: Write the failing test**

Agregar pruebas para dos rutas:

1. **Ruta principal plana**: normaliza opciones y produce dependencias internas resolubles.
2. **Compatibilidad temporal anterior**: si entra `{adapter, stateStore, backend}`, sigue funcionando solo como shim privado.

Ejemplo mínimo de compatibilidad temporal:

```js
const runtime = createSyncRuntime({adapter, stateStore, backend});
assert.equal(typeof runtime.getSyncStatus, 'function');
```

**Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/sync-engine.test.js
```

Expected: FAIL mientras no exista la capa de normalización.

**Step 3: Write minimal implementation**

Crear una unidad interna responsable de:
- detectar shape anterior (`adapter` o `stateStore` o `backend` presentes);
- convertir shape anterior al contrato interno común;
- validar la firma plana;
- aplicar defaults de campos opcionales (`branch`, `autoSync`, `autoPull`, `autoPush`, `ignorePatterns`, `buildCommitMessage`);
- producir un objeto interno único que `engine.js` consuma.

**Contrato interno recomendado**

```js
{
  config: {
    enabled,
    remoteUrl,
    branch,
    autoSync,
    autoPull,
    autoPush
  },
  sourceRoot,
  ignorePatterns,
  buildCommitMessage,
  stateStore,
  backend
}
```

**Compatibilidad temporal recomendada**
- Mantenerla **solo** dentro de `sync-core/runtime-options.js`.
- No documentarla en `sync-core/README.md` como API principal.
- Marcarla en comentario como transitoria y removible cuando `sync/index.js` y tests ya estén migrados.

**Step 4: Run test to verify it passes**

Run:

```bash
node --test tests/sync-engine.test.js
```

Expected: PASS para ruta plana y ruta anterior temporal.

**Success criteria**
- `engine.js` deja de depender conceptualmente de `adapter` como superficie pública.
- La compatibilidad temporal queda confinada a una sola pieza.

---

### Task 3: Resolver defaults internos de `stateStore` y `backend` dentro de `sync-core`

**Files:**
- Create: `sync-core/defaults.js` *(o `sync-core/runtime-dependencies.js`)*
- Modify: `sync-core/engine.js`
- Modify: `sync-core/backends/git-cli.js`
- Modify: `sync-core/state/file-store.js`
- Modify: `tests/sync-engine.test.js`
- Modify: `tests/sync-git-cli-backend.test.js`
- Modify: `tests/sync-state-store.test.js`

**Objetivo**
Hacer que el camino normal del runtime cree por sí mismo un backend y un state store funcionales sin exponer esas dependencias en la API principal.

**Step 1: Write the failing test**

Agregar en `tests/sync-engine.test.js` pruebas que verifiquen que:
- si no se pasa `stateStore`, el runtime usa un default interno;
- si no se pasa `backend`, el runtime usa `createGitCliBackend()`;
- el backend default recibe `remoteUrl`, `branch` e `ignorePatterns` correctos;
- el state store default persiste un estado base consistente.

Agregar en `tests/sync-state-store.test.js` una prueba reusable del factory default del core, sin depender de `sync/state-store.js`.

**Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/sync-engine.test.js tests/sync-state-store.test.js tests/sync-git-cli-backend.test.js
```

Expected: FAIL mientras el core siga esperando dependencias inyectadas desde fuera.

**Step 3: Write minimal implementation**

Crear un factory interno de defaults con estas responsabilidades:

1. **Default `backend`**
   - usar `createGitCliBackend()` del core;
   - `repoPath` debe resolverse a partir de `sourceRoot` en el caso normal actual del proyecto;
   - pasar `branch`, `remoteUrl` e `ignorePatterns` desde la firma plana;
   - no exponer este detalle en la API principal.

2. **Default `stateStore`**
   - reutilizar `createFileStateStore()`;
   - derivar internamente un `getStateFilePath()` estable y oculto;
   - si el repo snapshot vive en `sourceRoot`, el estado debe seguir fuera del set de archivos sincronizados o bajo un path ignorado por default;
   - el plan de implementación debe conservar el comportamiento actual del proyecto: no meter `sync-state.json` al snapshot remoto.

3. **Default state base**
   - mover a `sync-core` una función `defaultSyncState()` reusable por el core y por tests;
   - evitar seguir duplicando shape base entre `sync/state-store.js`, tests y engine harnesses.

**Decisión específica para defaults internos**
- **`backend`**: conviene resolverlo en un factory interno del core, no inline en `engine.js`, para poder reutilizarlo luego desde una API avanzada.
- **`stateStore`**: conviene resolverlo en el mismo factory interno, con un helper separado para `defaultSyncState()`.
- **No exponer** ninguno de los dos en la firma principal.

**Step 4: Run test to verify it passes**

Run:

```bash
node --test tests/sync-engine.test.js tests/sync-state-store.test.js tests/sync-git-cli-backend.test.js
```

Expected: PASS.

**Success criteria**
- La ruta normal ya no depende de inyección pública de `stateStore` y `backend`.
- Los defaults del core quedan centralizados y testeables.

---

### Task 4: Adaptar `engine.js` al contrato interno plano sin reescribir el runtime

**Files:**
- Modify: `sync-core/engine.js`
- Modify: `tests/sync-engine.test.js`

**Objetivo**
Cambiar solo el wiring de entrada del runtime, preservando la máquina de estados y el pipeline actual.

**Step 1: Write the failing test**

Agregar/ajustar asserts para confirmar que `engine.js`:
- toma `config` desde la normalización interna, no desde `adapter.getSyncConfig()`;
- toma `sourceRoot`, `ignorePatterns` y `buildCommitMessage` directamente del contrato interno;
- conserva orden operacional: `ensureReady -> syncWorkingTree -> hasChanges -> commit -> fetch -> integrate -> push`.

**Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/sync-engine.test.js
```

Expected: FAIL si todavía hay lecturas directas de `adapter.*`.

**Step 3: Write minimal implementation**

Refactor quirúrgico en `sync-core/engine.js`:
- reemplazar `adapter.getSyncConfig()` por `normalized.config`;
- reemplazar `adapter.getSourceRoot()` por `normalized.sourceRoot`;
- reemplazar `adapter.getIgnorePatterns()` por `normalized.ignorePatterns`;
- reemplazar `adapter.buildCommitMessage(context)` por `normalized.buildCommitMessage(context)`;
- usar `normalized.stateStore` y `normalized.backend`.

No tocar:
- `machine.js`;
- clasificación de errores;
- semántica de retry;
- shape de estado persistido.

**Step 4: Run test to verify it passes**

Run:

```bash
node --test tests/sync-engine.test.js tests/sync-machine.test.js
```

Expected: PASS.

**Success criteria**
- El runtime ya opera con la nueva entrada plana.
- La lógica del pipeline sigue estable.

---

### Task 5: Migrar `sync/index.js` para que el consumer use la API plana principal

**Files:**
- Modify: `sync/index.js`
- Modify: `sync/ilu-adapter.js`
- Modify: `sync/state-store.js`
- Modify: `tests/sync-engine.test.js`
- Modify: `tests/sync-ilu-adapter.test.js`

**Objetivo**
Quitar del camino normal del consumer la composición explícita de `backend` y `stateStore`.

**Step 1: Write the failing test**

Actualizar `tests/sync-engine.test.js` en la parte consumer para verificar que `sync/index.js` llama a `createEngineRuntime()` con la forma plana:

```js
{
  enabled: true,
  remoteUrl: '/tmp/consumer-remote.git',
  branch: 'trunk',
  autoSync: true,
  autoPull: true,
  autoPush: true,
  sourceRoot: '/tmp/consumer-source',
  ignorePatterns: ['.config/**'],
  buildCommitMessage: [Function]
}
```

Y que **no** manda `stateStore`/`backend` por default.

Agregar un test adicional que confirme que el adapter del consumer ya no necesita representar el contrato viejo del core.

**Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/sync-engine.test.js tests/sync-ilu-adapter.test.js
```

Expected: FAIL mientras `sync/index.js` siga armando `backend` y `stateStore` por fuera.

**Step 3: Write minimal implementation**

Cambios mínimos:
- `sync/index.js`
  - seguir leyendo config y paths desde `sync/ilu-adapter.js`;
  - dejar de construir `backend` y `stateStore` en el camino normal;
  - mantener solo un posible escape hatch temporal para tests/migración, si todavía hace falta, pero separado del camino público principal.
- `sync/ilu-adapter.js`
  - conservar `getSyncConfig()`, `getSourceRoot()`, `getIgnorePatterns()`, `buildCommitMessage()`;
  - no agregar aquí `stateStore` ni `backend`.
- `sync/state-store.js`
  - evaluar si sigue siendo necesario solo para bootstrap/CLI legado; si no, reducirlo a wrapper temporal o marcarlo como candidato a eliminación en cleanup posterior.

**Step 4: Run test to verify it passes**

Run:

```bash
node --test tests/sync-engine.test.js tests/sync-ilu-adapter.test.js
```

Expected: PASS.

**Success criteria**
- `ilu` ya consume el core como usuario normal de la API plana.
- La composición manual deja de ser el camino principal del repo.

---

### Task 6: Proteger compatibilidad temporal y bootstrap del CLI

**Files:**
- Modify: `sync/index.js`
- Modify: `sync/commands.js`
- Modify: `tests/sync-local-remote.integration.test.js`
- Optional modify: `tests/sync-init-command.test.js`
- Optional modify: `tests/sync-status-command.test.js`
- Optional modify: `tests/sync-retry-command.test.js`

**Objetivo**
Evitar que `sync init`, `status`, `retry`, `enable` y `disable` se rompan durante la migración.

**Step 1: Write the failing test**

Agregar/ajustar pruebas para cubrir:
- `sync.createSyncRuntime()` sin argumentos sigue funcionando para el consumer `ilu`;
- `sync.createSyncRuntime({backend})` todavía puede existir solo como compatibilidad temporal para `sync init` mientras termina la migración;
- el bootstrap con remoto vacío o con historia sigue pasando.

**Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/sync-local-remote.integration.test.js tests/sync-init-command.test.js tests/sync-status-command.test.js tests/sync-retry-command.test.js
```

Expected: FAIL en el primer punto donde el CLI todavía dependa del wiring anterior.

**Step 3: Write minimal implementation**

Recomendación mínima:
- mantener `createBootstrapBackend()` en `sync/index.js` mientras `sync/commands.js` lo necesite para `init`;
- permitir que `sync.createSyncRuntime({backend})` sobreviva **solo** como compatibilidad temporal interna del consumer, implementada encima del shim anterior del core;
- una vez estabilizado el refactor, mover `init` a usar una ruta más explícita de bootstrap separada del runtime principal si sigue siendo necesario.

**Step 4: Run test to verify it passes**

Run:

```bash
node --test tests/sync-local-remote.integration.test.js tests/sync-init-command.test.js tests/sync-status-command.test.js tests/sync-retry-command.test.js
```

Expected: PASS.

**Success criteria**
- El CLI no se rompe durante la migración.
- La compatibilidad temporal queda acotada a bootstrap/migración, no a la API pública principal.

---

### Task 7: Separar y documentar la API avanzada solo después de estabilizar la principal

**Files:**
- Create: `sync-core/advanced.js` *(o export equivalente)*
- Modify: `sync-core/engine.js`
- Modify: `sync-core/README.md`
- Modify: `tests/sync-engine.test.js`

**Objetivo**
Exponer extensibilidad avanzada sin contaminar `createSyncRuntime()`.

**Cuándo conviene introducirla**
**Fase posterior al refactor principal**, no al inicio. Debe entrar cuando ya se cumplan estas condiciones:
- la API plana ya está consumida por `ilu`;
- los defaults internos ya están centralizados;
- la compatibilidad temporal anterior ya existe o ya no hace falta;
- la separación entre ruta normal y ruta avanzada ya se puede expresar sin mezclar responsabilidades.

**Step 1: Write the failing test**

Agregar pruebas para un API avanzada explícita, por ejemplo:

```js
const runtime = createSyncRuntimeAdvanced({
  config: {...},
  sourceRoot: '/tmp/source',
  ignorePatterns: ['.config/**'],
  buildCommitMessage() {
    return 'sync(test): save local data snapshot';
  },
  stateStore,
  backend
});
```

Asserts mínimos:
- acepta inyección explícita de dependencias;
- comparte semántica del runtime principal;
- no cambia la superficie de `createSyncRuntime()`.

**Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/sync-engine.test.js
```

Expected: FAIL porque el export avanzado todavía no existe.

**Step 3: Write minimal implementation**

Implementar `createSyncRuntimeAdvanced()` como wrapper del mismo contrato interno normalizado, pero requiriendo dependencias explícitas cuando aplique.

Regla de diseño:
- `createSyncRuntime()` = API principal plana para usuario normal.
- `createSyncRuntimeAdvanced()` = API explícita para extensibilidad.
- No mezclar ambos modos en la misma firma.

**Step 4: Run test to verify it passes**

Run:

```bash
node --test tests/sync-engine.test.js
```

Expected: PASS.

**Success criteria**
- La extensibilidad queda disponible sin ensuciar la API principal.

---

### Task 8: Actualizar README y limpiar compatibilidad temporal visible

**Files:**
- Modify: `sync-core/README.md`
- Optional modify: `sync/index.js`
- Optional modify: `tests/sync-engine.test.js`

**Objetivo**
Cerrar el refactor dejando la documentación pública alineada con la API plana y minimizando deuda transitoria visible.

**Step 1: Write the failing test / doc check**

No hace falta un test automatizado nuevo si no existe doc lint, pero sí una checklist explícita:
- README ya no presenta `{adapter, stateStore, backend}` como entrada principal.
- README sí muestra `sourceRoot` e `ignorePatterns` en la firma principal.
- README explica que la API avanzada, si existe, es secundaria.

**Step 2: Apply minimal documentation update**

Actualizar ejemplos a:

```js
const runtime = createSyncRuntime({
  enabled: true,
  remoteUrl: '/tmp/remote.git',
  branch: 'main',
  autoSync: true,
  autoPull: true,
  autoPush: true,
  sourceRoot: '/ruta/a/datos',
  ignorePatterns: ['.config/**'],
  buildCommitMessage(context = {}) {
    return `sync(${context.domain || 'data'}): ${context.action || 'save'} local data snapshot`;
  }
});
```

Documentar la compatibilidad anterior solo si todavía sigue viva internamente, pero como nota de migración, no como contrato principal.

**Step 3: Final verification run**

Run:

```bash
node --test tests/sync-engine.test.js tests/sync-machine.test.js tests/sync-git-cli-backend.test.js tests/sync-state-store.test.js tests/sync-ilu-adapter.test.js tests/sync-init-command.test.js tests/sync-status-command.test.js tests/sync-retry-command.test.js tests/sync-local-remote.integration.test.js
```

Expected: PASS.

**Success criteria**
- Contrato público, implementación y documentación quedan alineados.

---

## Respuestas concretas a los puntos pedidos

### 1) Qué archivos tocar

**Seguro tocar**
- `sync-core/engine.js`
- `sync-core/backends/git-cli.js`
- `sync-core/state/file-store.js`
- `sync/index.js`
- `sync/commands.js`
- `sync/ilu-adapter.js`
- `tests/sync-engine.test.js`
- `tests/sync-git-cli-backend.test.js`
- `tests/sync-state-store.test.js`
- `tests/sync-ilu-adapter.test.js`
- `tests/sync-local-remote.integration.test.js`
- `sync-core/README.md`

**Muy probable crear**
- `sync-core/runtime-options.js`
- `sync-core/defaults.js`
- `sync-core/advanced.js` *(fase posterior)*

### 2) Secuencia mínima de refactor

1. Congelar tests de la firma plana.
2. Añadir normalización interna + shim anterior privado.
3. Mover defaults de `stateStore` y `backend` dentro del core.
4. Adaptar `engine.js` al contrato interno plano.
5. Migrar `sync/index.js` al nuevo camino principal.
6. Proteger bootstrap/CLI e integración.
7. Solo después introducir `createSyncRuntimeAdvanced()`.
8. Actualizar docs y limpiar compatibilidad visible.

### 3) Cómo mantener compatibilidad temporal si hace falta

- Sí conviene mantenerla temporalmente.
- Debe vivir solo en una capa de normalización interna del core.
- Debe aceptar `{adapter, stateStore, backend}` solo para migrar `sync/index.js`, tests y bootstrap.
- No debe aparecer en README como API principal.
- Debe tener tests propios para poder eliminarla luego sin miedo.

### 4) Qué tests escribir/ajustar primero

Orden recomendado:
1. `tests/sync-engine.test.js` — nueva firma plana y compatibilidad temporal.
2. `tests/sync-state-store.test.js` — default state/default store del core.
3. `tests/sync-git-cli-backend.test.js` — composición del backend default.
4. `tests/sync-engine.test.js` (consumer section) + `tests/sync-ilu-adapter.test.js` — migración de `sync/index.js`.
5. `tests/sync-local-remote.integration.test.js` y comandos — no regresión del CLI.

### 5) Cómo resolver defaults internos de `stateStore` y `backend` sin exponerlos

- Crear un factory interno del core que reciba la configuración plana ya normalizada.
- `backend`: usar el Git backend existente con `repoPath`, `branch`, `remoteUrl`, `ignorePatterns` derivados internamente.
- `stateStore`: usar `createFileStateStore()` con `defaultSyncState()` del core y un path resuelto internamente que quede fuera del set sincronizado o bajo un ignore garantizado.
- Dejar ambos como detalle interno reusable por la futura API avanzada, pero no como parte del contrato principal.

### 6) Si conviene introducir `createSyncRuntimeAdvanced()` o equivalente, en qué fase

- Sí conviene.
- No en la fase 1.
- Introducirla **después** de que la API plana principal y sus defaults internos ya estén estables y consumidos por `ilu`.
- Fase recomendada: **Task 7**, cuando ya no sea necesario mezclar extensibilidad con migración.

---

## Riesgos residuales a vigilar

- Que el default `stateStore` termine guardándose en una ruta que accidentalmente entre al snapshot remoto.
- Que `sync init` dependa más de la composición anterior de lo que hoy aparenta.
- Que algunos tests del consumer sigan asumiendo inyección explícita de `backend/stateStore` y oculten regresiones del nuevo camino principal.
- Que la compatibilidad temporal se quede viva demasiado tiempo y vuelva ambigua la frontera pública.

## Verificación final esperada

Comando principal de verificación al terminar la implementación:

```bash
node --test
```

Si ese run completo fuera demasiado costoso durante el ciclo TDD, usar primero los comandos focalizados de cada task y cerrar con `node --test` al final.
