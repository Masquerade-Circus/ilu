# `sync-core`

Sincronización local-first para carpetas de datos, archivos y configuración de usuario en proyectos Node.js.

## ¿Qué es?

`sync-core` es una librería para agregar sincronización confiable a herramientas y aplicaciones que guardan datos localmente primero y después los sincronizan con un remoto.

Su trabajo es encargarse de la capa difícil de sync: detectar trabajo pendiente, sincronizar una carpeta fuente, conservar estado, degradarse con claridad cuando algo falla y permitir recuperación sin perder el foco local-first.

## ¿Qué problema resuelve?

Guardar archivos locales es fácil. Convertir eso en una experiencia de sincronización usable y mantenible no lo es.

Cuando una herramienta guarda datos del usuario en disco, normalmente aparecen problemas como estos:

- la escritura local no debe depender del remoto;
- no todo lo que existe en la carpeta debe sincronizarse;
- hace falta saber si hay cambios pendientes por subir;
- los errores de red, autenticación o conflicto no deberían romper la experiencia local;
- el estado de sincronización debe sobrevivir entre ejecuciones;
- no quieres mezclar lógica de negocio con lógica de retry, degradación y sincronización.

`sync-core` existe para resolver esa capa. Te permite tratar una carpeta local como fuente de trabajo y delegar al core la responsabilidad de mantenerla sincronizada con un remoto bajo una estrategia local-first.

## ¿Para quién es?

`sync-core` está pensado para developers que construyen:

- CLIs con almacenamiento local;
- herramientas de productividad;
- developer tools;
- utilidades que guardan archivos o snapshots del usuario;
- apps Node.js que trabajan con una carpeta local de datos o configuración.

Es una buena opción si tu proyecto:

- persiste datos en archivos;
- necesita sincronizar con un remoto;
- necesita reglas de exclusión;
- quiere separar el sync de la lógica de producto;

## Beneficios principales

### 1) Local-first de verdad

La prioridad es la persistencia local. La sincronización remota ocurre después.

Eso ayuda a evitar que una escritura del usuario dependa de la red o de la salud del remoto para poder completarse.

### 2) Trabaja con carpetas reales, no con una lista rígida de archivos

El core opera sobre una carpeta fuente y patrones de exclusión.

Eso lo vuelve más útil para proyectos reales donde los datos viven como árbol de archivos.

### 3) Estados explícitos y útiles

No reduce todo a “sirvió / falló”.

El runtime puede representar estados como:

- `disabled`
- `healthy`
- `pending_remote`
- `degraded_network`
- `degraded_auth`
- `conflict`
- `misconfigured`

Eso facilita integrar mensajes claros, diagnósticos, retries y UX más honestas.

### 4) Reintentos y degradación sin improvisar

Cuando el remoto falla, el core puede conservar el trabajo pendiente y dejar el sistema listo para reintento, en lugar de hacer que tu app invente esa lógica una y otra vez.

### 5) Separación entre dominio y sincronización

Tu aplicación define qué datos guarda, dónde los guarda y qué quiere excluir.

`sync-core` se encarga del flujo de sincronización.

## Cómo pensar `sync-core`

La forma correcta de entenderlo es esta:

> Tu producto guarda datos locales.  
> `sync-core` convierte eso en una experiencia de sincronización confiable.

De esta forma no tienes que mezclar:

- persistencia local,
- detección de trabajo pendiente,
- pipeline de sincronización,
- degradación,
- retry,
- y estado persistido de sync

dentro del mismo lugar donde vive tu dominio.

## Alcance de `sourceRoot`

Se sincroniza todo el contenido ubicado dentro de `sourceRoot`, con dos excepciones: cualquier ruta que coincida con `ignorePatterns` y la carpeta `.config`.

En términos prácticos, esto significa que `.config` nunca se sincroniza, aunque esté dentro de `sourceRoot`. Por lo tanto, es seguro guardar ahí configuraciones adicionales cuando el dominio del developer lo requiera, sin que formen parte de la sincronización.

## Integración breve

La API principal es plana y está pensada para el caso normal.

El runtime principal se crea así:

```js
const { createSyncRuntime } = require("./sync-core/engine");

const runtime = createSyncRuntime({
  enabled: true,
  remoteUrl: "/tmp/remote.git",
  branch: "main",
  autoSync: true,
  autoPull: true,
  autoPush: true,
  sourceRoot: "/ruta/a/tu/carpeta-de-datos",
  ignorePatterns: [".config/**"],
  buildCommitMessage(context = {}) {
    return `sync(${context.domain || "data"}): ${context.action || "save"} local data snapshot`;
  }
});
```

Después, tu aplicación normalmente interactúa con el runtime así:

```js
await runtime.notifyLocalMutation({
  domain: "todos",
  action: "save"
});

const status = runtime.getSyncStatus();
```

Y cuando hace falta reintentar:

```js
await runtime.retry({ reason: "manual" });
```

## API principal vs API avanzada

### API principal: `createSyncRuntime()`

Esta es la ruta recomendada para casi todos los consumers.

La API principal recibe solo configuración de uso común:

- flags de sync (`enabled`, `autoSync`, `autoPull`, `autoPush`);
- remoto (`remoteUrl`, `branch`);
- carpeta fuente (`sourceRoot`);
- exclusiones (`ignorePatterns`);
- mensaje de snapshot (`buildCommitMessage`).

El core resuelve internamente el backend y el state store por default.

### API avanzada: `createSyncRuntimeAdvanced()`

Solo usa esta ruta si necesitas extensibilidad explícita. Para el caso normal, sigue usando `createSyncRuntime()`.

```js
const { createSyncRuntimeAdvanced } = require("./sync-core/advanced");

const runtime = createSyncRuntimeAdvanced({
  config: {
    enabled: true,
    remoteUrl: "/tmp/remote.git",
    branch: "main",
    autoSync: true,
    autoPull: true,
    autoPush: true
  },
  sourceRoot: "/ruta/a/tu/carpeta-de-datos",
  ignorePatterns: [".config/**"],
  buildCommitMessage(context = {}) {
    return `sync(${context.domain || "data"}): ${context.action || "save"} local data snapshot`;
  },
  stateStore,
  backend
});
```

Regla de diseño:

- `createSyncRuntime()` = API simple principal.
- `createSyncRuntimeAdvanced()` = API avanzada para inyección explícita.
- No mezclar ambas firmas en el mismo entrypoint.

## Responsabilidades del consumer vs del core

## Lo que le toca al consumer

El consumer es responsable de:

- decidir dónde vive la carpeta fuente;
- definir qué rutas o patrones deben ignorarse;
- entregar la configuración de sync;
- definir cómo describir cada snapshot;
- decidir cómo presentar la experiencia en CLI, UI o comandos.

También le toca decidir qué eventos de dominio disparan `notifyLocalMutation()`.

Si necesita composición manual de `stateStore` o `backend`, eso ya pertenece a la API avanzada, no a la integración principal.

## Lo que resuelve el core

`sync-core` se hace cargo de:

- normalizar y rehidratar el estado de sync;
- mantener una máquina de estados operativa para el flujo de sincronización;
- reaccionar a mutaciones locales;
- ejecutar el pipeline de sync;
- clasificar errores comunes en categorías útiles;
- conservar trabajo pendiente cuando el remoto falla;
- habilitar retry;
- exponer un estado legible para diagnóstico e integración.

> **Nota sobre conflictos:** `sync-core` no resuelve conflictos automáticamente. Si durante la sincronización aparecen conflictos, deben revisarse y resolverse con Git, GitHub o una herramienta externa de merge/diff.

## Alcance actual

Hoy `sync-core` cubre un problema concreto y acotado:

- sincronización basada en carpeta fuente;
- reglas de exclusión con `ignorePatterns`;
- persistencia de estado;
- estrategia local-first;
- retry explícito;
- estados degradados útiles;
- clasificación de errores de sync;
- composición mediante contratos pequeños;
- una ruta avanzada explícita para extensibilidad cuando hace falta.

No intenta cubrir todo el universo de sincronización. Intenta resolver bien un caso específico y frecuente en tools basadas en archivos.

## Límites actuales y honestidad de alcance

Conviene ser explícitos:

- es reusable, pero **no** universal;
- está orientado a snapshots de una carpeta local;
- el backend reusable observado hoy es opinionado hacia Git CLI y filesystem;
- por default, ese backend opera sobre `sourceRoot` usando Git CLI y puede crear o actualizar `.git`, `.gitignore` y `.config/sync-state.json`; los `ignorePatterns` se registran en `.gitignore`, y la carpeta `.config` también se excluye automáticamente;
- la integración principal ya no exige composición manual de backend/state store;
- la composición manual vive en la API avanzada y sigue siendo una integración de bajo nivel para developers;
- si buscas colaboración en tiempo real, merge semántico complejo o sync distribuido generalista, este no es ese producto.

En otras palabras: `sync-core` ayuda mucho cuando tu problema se parece al que resuelve. No pretende fingir que resuelve todos los demás.

## Cuándo sí tiene buen fit

`sync-core` tiene buen fit si:

- tu aplicación guarda archivos del usuario en disco;
- quieres mantener la escritura local como prioridad;
- necesitas sincronizar una carpeta completa;
- quieres dejar fuera ciertos archivos o directorios;
- necesitas retries y estados explícitos;
- quieres separar tu lógica de producto de la lógica de sync.

## Cuándo probablemente no

Probablemente no es la mejor opción si necesitas:

- edición colaborativa en tiempo real;
- reconciliación avanzada entre múltiples actores;
- un protocolo de sync completamente agnóstico y abstracto;
- una solución cerrada que no requiera composición del lado del consumer.

## Resumen

`sync-core` no intenta ser “la librería de sync para todo”.

Su propuesta es más concreta:

**darle a una app o herramienta Node.js una base confiable para sincronizar una carpeta local de datos/configuración del usuario con un remoto, manteniendo una estrategia local-first, estado persistido y una integración pública clara mediante una API plana.**

Si tu producto ya guarda datos en archivos y lo que te falta es una capa de sync seria, reusable y honesta sobre su alcance, ese es exactamente el espacio donde `sync-core` quiere ayudarte.
