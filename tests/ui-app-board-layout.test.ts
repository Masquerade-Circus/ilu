import test from 'node:test';
import assert from 'node:assert/strict';
import {captureIluScenario} from './test-helpers/terminal-capture.ts';
import {captureCommand, assertCaptureArtifacts} from './test-helpers/terminal-capture-scenarios.ts';

test('physical capture Board keyboard, pointer and viewport resizing preserve real data and aligned columns', async context => {
  const result = await captureIluScenario({testName: context.name, scenario: 'boardLayout', command: captureCommand, viewport: {cols: 80, rows: 24}});
  assert.equal(result.exitCode, 0);
  assertCaptureArtifacts({result, testName: context.name, checkpoints: ['board-before', 'board-layout-mode', 'board-keyboard', 'board-dragged', 'board-resized'], diagnostic: message => context.diagnostic(message)});
});

const longTitle = 'Card with a very long title that wraps across multiple visual rows inside the board column';
const fixtures = {
  standard: [{title: 'Backlog', wipLimit: 3, cards: [{title: 'Write tests'}, {title: 'Wire UI'}, {title: 'Third card'}]}, {title: 'Doing', cards: [{title: 'Other'}]}, {title: 'Done', cards: []}],
  layout: [{title: 'Backlog', cards: [{title: `Long ${'x'.repeat(120)}`}]}, {title: 'Ready', cards: [{title: 'Other'}]}],
  many: [{title: 'Backlog', cards: Array.from({length: 30}, (_, index) => ({title: `Card ${index + 1}`}))}, {title: 'Done', cards: []}],
  second: [{title: 'Backlog', cards: []}, {title: 'Doing', cards: Array.from({length: 30}, (_, index) => ({title: `Card ${index + 1}`}))}],
  wrapped: [{title: 'Backlog', cards: Array.from({length: 10}, (_, index) => ({title: `${longTitle} ${index + 1}`}))}],
  mixed: [{title: 'Backlog', cards: Array.from({length: 10}, (_, index) => ({title: index % 2 === 0 ? `${longTitle} ${index + 1}` : `Short ${index + 1}`}))}],
  duplicate: [{title: 'Backlog', cards: Array.from({length: 30}, (_, index) => ({title: 'Duplicate', description: `Identity ${index + 1}`}))}, {title: 'Done', cards: []}],
  six: ['Todo', 'Doing', 'Review', 'Blocked', 'Done', 'Archive'].map((title, index) => ({title, cards: [{title: `Card ${index + 1}`}]})),
  few: [{title: 'Backlog', cards: [{title: 'One'}]}],
  sixCards: [{title: 'Backlog', cards: Array.from({length: 6}, (_, index) => ({title: `Card ${index + 1}`}))}],
  primitive: [{title: 'Backlog', cards: ['Plain string card', null, null]}],
  longHeader: [{title: 'Column title that cannot fit inside the fixed header', cards: Array.from({length: 12}, (_, index) => ({title: index === 0 ? 'Visible card' : `Card ${index + 1}`}))}, {title: 'Doing', cards: [{title: 'Second card'}]}, {title: 'Done', cards: [{title: 'Third card'}]}]
};

// Every row keeps its original test name. tuiInteraction must interpret visual
// assertions against the live PTY and persisted data, never a headless rerender.
// Layout entry reads the advertised Help shortcut. It must not hardcode an
// alternative gesture or replace Shift+arrows with a different operation.
const cases = [
  ['terminal integration Board keyboard width adjustment preserves data, minimums and content arrows after Esc', 'layout', [
    {remember: ['boards']}, {rememberBoardGeometry: 'initial'}, {enterBoardLayoutViaHelp: true}, {key: 'SHIFT_RIGHT', repeat: 2}, {key: 'ESCAPE'},
    {expect: {boardGeometry: {widerFirstThan: 'initial', alignedHeadersCardsCounters: true, longerVisibleTitleThan: 'initial'}}}, {unchanged: ['boards']},
    {enterBoardLayoutViaHelp: true}, {key: 'SHIFT_LEFT', repeat: 30}, {key: 'ESCAPE'}, {expect: {text: 'Long'}},
    {enterBoardLayoutViaHelp: true}, {key: 'SHIFT_RIGHT', repeat: 30}, {key: 'ESCAPE'}, {expect: {text: 'Other'}}, {unchanged: ['boards']},
    {key: 'RIGHT'}, {data: {domain: 'boards', cardPrefix: 'Long', column: 'Ready'}},
    {click: 'Ready'}, {key: 'LEFT'}, {data: {domain: 'boards', firstColumn: 'Ready'}}
  ]],
  ['terminal integration Board pointer resizing coordinates headers and lists and survives viewport changes', 'layout', [
    {remember: ['boards']}, {rememberBoardGeometry: 'initial'}, {dragDivider: {between: ['Backlog', 'Ready'], deltas: [3, 7]}},
    {expect: {boardGeometry: {widerFirstThan: 'initial', alignedHeadersCardsCounters: true, eachDragMoveAdvances: true, longerVisibleTitleThan: 'initial'}}},
    {key: 'CTRL_K'}, {key: 'ESCAPE'}, {expect: {boardGeometry: {retainedAfterRedraw: true}}},
    {resize: {cols: 120, rows: 30}}, {expect: {boardGeometry: {alignedHeadersCardsCounters: true}}},
    {resize: {cols: 80, rows: 24}}, {expect: {texts: ['Long', 'Other', 'Add card'], withinViewport: true}}, {unchanged: ['boards']}
  ]],
  ['Board action bar reemplaza Columns por Add column y abre add-column directo', 'standard', [{click: 'Add column'}, {type: 'Focused column'}, {expect: {text: 'Focused column'}}, {click: 'Cancel'}]],
  ['Board doublepress en header de segunda columna abre detalle de esa columna sin botones Left Right', 'standard', [{doubleClick: 'Doing'}, {expect: {text: 'Column: Doing', overlayTexts: ['Rename', 'WIP', 'Default', 'Remove column', 'Close'], overlayAbsent: ['Left', 'Right', 'Reset to default layout']}}, {key: 'ESCAPE'}]],
  ['Board identifica card seleccionado con marcador sobrio y flechas verticales actualizan seleccion', 'standard', [{key: 'DOWN'}, {expect: {selectedText: 'Wire UI', text: 'Write tests'}}, {key: 'o'}, {expect: {text: 'Wire UI'}}, {key: 'ESCAPE'}]],
  ['Board flechas izquierda y derecha mueven la card seleccionada a la columna vecina', 'standard', [{click: 'Write tests'}, {key: 'RIGHT'}, {data: {domain: 'boards', card: 'Write tests', column: 'Doing'}}, {expect: {selectedText: 'Write tests'}}, {key: 'LEFT'}, {data: {domain: 'boards', card: 'Write tests', column: 'Backlog'}}, {expect: {selectedText: 'Write tests'}}]],
  ['Board Shift+Up and Shift+Down persist card priority and keep moved card selected', 'standard', [{click: 'Wire UI'}, {key: 'SHIFT_UP'}, {data: {domain: 'boards', column: 'Backlog', cardTitles: ['Wire UI', 'Write tests', 'Third card']}}, {expect: {selectedText: 'Wire UI'}}, {key: 'SHIFT_DOWN'}, {data: {domain: 'boards', column: 'Backlog', cardTitles: ['Write tests', 'Wire UI', 'Third card']}}, {expect: {selectedText: 'Wire UI'}}]],
  ['Board Shift priority shortcut is scoped to card lists and no-ops at boundaries', 'standard', [{click: 'Write tests'}, {remember: ['boards']}, {key: 'SHIFT_UP'}, {click: 'Backlog'}, {key: 'SHIFT_DOWN'}, {unchanged: ['boards']}]],
  ['Board flechas izquierda y derecha son no-op sin card seleccionada o sin columna vecina', 'standard', [{remember: ['boards']}, {key: 'RIGHT'}, {unchanged: ['boards']}, {click: 'Write tests'}, {key: 'LEFT'}, {unchanged: ['boards']}, {expect: {selectedText: 'Write tests'}}]],
  ['Board mover card enfoca columna destino y mantiene la card movida seleccionada', 'standard', [{click: 'Write tests'}, {key: 'o'}, {click: 'Move'}, {click: 'Doing', area: 'overlay'}, {data: {domain: 'boards', card: 'Write tests', column: 'Doing'}}, {expect: {selectedText: 'Write tests'}}, {key: 'LEFT'}, {data: {domain: 'boards', card: 'Write tests', column: 'Backlog'}}]],
  ['Board muestra todas las columnas disponibles del read-model en el ancho actual', 'six', [{expect: {sameRow: ['Card 1', 'Card 2', 'Card 3', 'Card 4', 'Card 5', 'Card 6'], absent: 'more columns', withinViewport: true}}]],
  ['Board muestra todos los cards y no renderiza marcador de more cards', 'sixCards', [{expect: {texts: ['Card 1', 'Card 2', 'Card 3', 'Card 4', 'Card 5', 'Card 6'], absentPattern: '\\+\\d+ more cards'}}]],
  ['Board columnas toman todo el alto disponible antes de action bar y footer', 'standard', [{expect: {columnBorderRows: 18, columnBackgroundAbsent: '#0f172a', pageBottomActions: ['Add card', 'Add column']}}]],
  ['Board con pocos cards conserva borde inferior dentro del alto real de columna', 'few', [{expect: {columnBorderRows: 18, columnBottomBorder: true, withinViewport: true}}]],
  ['Board renderiza columnas horizontales fluidas sin gutter y headers con contador', 'standard', [{expect: {sameRow: ['Backlog', '(3/3)', 'Doing', '(1)', 'Done', '(0)'], columnGutter: 0, countersAfterTitles: true, withinViewport: true}}]],
  ['Board headers no heredan background ANSI de Button', 'standard', [{expect: {headerBackground: '#0d1117'}}]],
  ['Board renderiza columnas con borde y sin surface ANSI propio', 'standard', [{expect: {columnBorders: true, columnGutter: 0, columnBackgroundAbsent: '#0f172a'}}]],
  ['Board renderiza marcador sobrio cuando existe selectedCard previo', 'standard', [{click: 'Write tests'}, {key: 'CTRL_K'}, {key: 'ESCAPE'}, {expect: {selectedText: 'Write tests', cardBackgroundAbsent: ['#1f2328', '#2e3440', '#3b4252', '#2b3137']}}]],
  ['Board doublepress del mismo card vuelve a abrir despues de cerrar con boton Close', 'standard', [{doubleClick: 'Write tests'}, {expect: {text: 'Backlog | Write tests'}}, {click: 'Close', area: 'overlay'}, {doubleClick: 'Write tests'}, {expect: {text: 'Backlog | Write tests'}}, {key: 'ESCAPE'}]],
  ['Board doublepress valido en otro card no queda bloqueado despues de cerrar detalle de columna', 'standard', [{doubleClick: 'Backlog'}, {click: 'Close', area: 'overlay'}, {doubleClick: 'Wire UI'}, {expect: {text: 'Backlog | Wire UI'}}, {key: 'ESCAPE'}]],
  ['Board pinta marcador de seleccion para un card seleccionado que no es la primera fila', 'standard', [{click: 'Wire UI'}, {expect: {selectedText: 'Wire UI', notSelectedText: 'Write tests'}}]],
  ['Board muestra titulos largos de cards en filas visuales sin elipsis', 'wrapped', [{expect: {wrappedComplete: [`${longTitle} 1`], absent: '…'}}]],
  ['Board clickAt visible de card usa press semantico de List para seleccionar sin abrir detalles', 'standard', [{click: 'Write tests'}, {expect: {selectedText: 'Write tests', absent: 'Backlog | Write tests'}}]],
  ['Board cards se seleccionan con press simple delegado a List', 'standard', [{click: 'Write tests'}, {hover: 'Write tests'}, {expect: {selectedText: 'Write tests', absent: 'Backlog | Write tests', cardBackgroundAbsent: ['#2b3137', '#3b4252', '#2e3440']}}]],
  ['Board click por coordenadas dentro del List selecciona por press semantico', 'few', [{clickCell: {column: 30, row: 10}}, {clickCell: {column: 30, row: 10}}, {expect: {selectedText: 'One', absent: 'Edit card'}}]],
  ['Board reduce padding local de cards sin tocar el layout horizontal', 'standard', [{expect: {cardPadding: 0, columnGutter: 0, alignedHeadersCards: true}}]],
  ['Board flecha real usa List interno sin viewport manual en el primer evento', 'many', [{expect: {firstVisibleCard: 'Card 1'}}, {key: 'DOWN'}, {expect: {firstVisibleCard: 'Card 1', absent: 'Edit card'}}]],
  ['Board rueda real cambia contenido visible desde el primer evento', 'many', [{expect: {firstVisibleCard: 'Card 1'}}, {scroll: {text: 'Card 1', direction: 'down', count: 1}}, {expect: {firstVisibleCard: 'Card 2'}}]],
  ['Board List virtualizado muestra scrollbar y acepta rueda sobre el track visible', 'many', [{expect: {scrollbar: true}}, {scroll: {target: 'scrollbar', direction: 'down', count: 1}}, {expect: {firstVisibleCard: 'Card 2', withinViewport: true}}]],
  ['Board List con cards envueltos muestra scrollbar y wheel cambia filas visuales', 'wrapped', [{expect: {scrollbar: true}}, {rememberScreen: 'before'}, {scroll: {text: 'Card with', direction: 'down', count: 1}}, {expect: {screenChangedSince: 'before', text: 'board column 1', withinViewport: true}}]],
  ['Board List con cards envueltos mantiene scrollbar estable al cambiar selección', 'mixed', [{rememberScrollbar: 'initial'}, {key: 'DOWN'}, {expect: {scrollbarSameAs: 'initial'}}, {key: 'DOWN'}, {expect: {scrollbarSameAs: 'initial'}}]],
  ['Board List normaliza cards primitivas y vacias con marcador visible estable', 'primitive', [{expect: {text: 'Plain string card', occurrences: {Untitled: 2}, absent: ['null', 'undefined'], withinViewport: true}}]],
  ['Board List con cards envueltos selecciona la card real desde una linea visual envuelta', 'wrapped', [{click: 'the board column 1'}, {expect: {selectedText: 'Card with a very long title', absent: 'Edit card'}}]],
  ['Board rueda real cambia segunda columna sin depender del foco inicial', 'second', [{scroll: {text: 'Card 1', direction: 'down', count: 1}}, {expect: {firstVisibleCard: 'Card 2'}}]],
  ['Board flecha real en segunda columna usa List interno sin priming secreto', 'second', [{click: 'Card 1'}, {key: 'DOWN'}, {expect: {firstVisibleCard: 'Card 1', absent: 'Doing | Card 1'}}]],
  ['Board headers son controles semanticos para seleccionar columna sin abrir cards', 'standard', [{click: 'Doing'}, {expect: {absent: 'Column: Doing', headerBackgroundNot: '#1f5f9e'}}, {key: 'o'}, {expect: {text: 'Column: Doing'}}, {key: 'ESCAPE'}]],
  ['Board hace scroll con flechas en uso real sin enfocar el List desde el test', 'many', [{key: 'DOWN', repeat: 18}, {expect: {selectedText: 'Card 19', absent: 'Edit card'}}]],
  ['Board hace scroll por teclado en List sin seleccion visible ni seleccion de app', 'many', [{key: 'DOWN', repeat: 18}, {expect: {selectedText: 'Card 19', cardBackgroundAbsent: ['#2e3440', '#3b4252', '#2b3137']}}]],
  ['Board mueve viewport por rueda sin cambiar seleccion de app', 'many', [{scroll: {text: 'Card 1', direction: 'down', count: 1}}, {expect: {text: 'Card 2', notSelectedText: 'Card 2'}}]],
  ['Board no selecciona otra card cuando la rueda mueve viewport dentro de una card envuelta', 'wrapped', [{click: 'Card with'}, {scroll: {text: 'Card with', direction: 'down', count: 1}}, {expect: {notSelectedText: `${longTitle} 2`}}, {key: 'o'}, {expect: {text: `${longTitle} 1`}}, {key: 'ESCAPE'}]],
  ['Board selecciona por teclado la card activa aunque el listado tenga titulos duplicados', 'duplicate', [{key: 'DOWN', repeat: 5}, {key: 'ENTER'}, {expect: {absent: 'Edit card'}}, {key: 'o'}, {expect: {text: 'Identity 6'}}, {key: 'ESCAPE'}]],
  ['Board hace scroll del listado por rueda y mantiene header visible', 'many', [{scroll: {text: 'Card', direction: 'down', count: 18}}, {expect: {sameRow: ['Backlog', 'Done'], textPattern: 'Card (19|20|21)', absentPattern: '\\+\\d+ more cards'}}]],
  ['Board selecciona card con click simple y abre detalle con doble click', 'standard', [{doubleClick: 'Doing'}, {click: 'Close', area: 'overlay'}, {click: 'Other'}, {expect: {selectedText: 'Other', absent: 'Doing | Other'}}, {doubleClick: 'Other'}, {expect: {text: 'Doing | Other'}}, {key: 'ESCAPE'}]],
  ['Board horizontal permanece dentro de 80x24 con action bar y footer fijos', 'longHeader', [{expect: {withinViewport: true, pageBottomActions: ['Add card', 'Add column'], footerActionsVisible: true, sameRow: ['(12)', 'Doing', 'Done']}}]],
  ['Board column header omite titulos que no caben completos en una linea fija', 'longHeader', [{expect: {text: '(12)', absent: ['Column title', 'cannot fit', 'fixed header'], withinViewport: true}}]],
  ['Board no renderiza titulos largos de columna en headers fijos cuando no caben completos', 'longHeader', [{expect: {texts: ['(12)', 'Visible card'], absent: ['Column title', 'cannot fit', 'fixed header'], withinViewport: true}}]],
  ['Board ignores multi-line paste when focus is not a text entry', 'standard', [{remember: ['boards']}, {type: 'Injected text\nSecond line'}, {expect: {absent: ['Injected text', 'Edit card']}}, {unchanged: ['boards']}]],
  ['Board action bar is contextual, fixed above footer, and top nav stays global only', 'standard', [{expect: {pageBottomActions: ['Add card', 'Add column'], navAbsent: ['Add card', 'Add column', 'Priority', 'Remove'], actionAreaAbsent: ['Details', 'Edit', 'Move', 'Priority', 'Remove']}}]],
  ['Board action bar mantiene solo acciones generales aunque haya card seleccionado', 'standard', [{click: 'Write tests'}, {expect: {selectedText: 'Write tests', pageBottomActions: ['Add card', 'Add column'], actionAreaAbsent: ['Details', 'Edit', 'Move', 'Priority', 'Remove']}}]],
  ['Board-only action bar labels are hidden outside Board', 'standard', [{key: 'CTRL_1'}, {expect: {absent: ['Add card', 'Priority', 'Columns']}}]],
  ['Board card actions stay hidden until a card is selected', 'standard', [{expect: {absent: ['Details', 'Edit', 'Move', 'Priority', 'Remove', '[object Object]', 'undefined', 'null']}}]],
  ['Board click simple de card selecciona sin abrir detalle', 'standard', [{click: 'Write tests'}, {expect: {selectedText: 'Write tests', absent: ['Backlog | Write tests', '[object Object]']}}]]
] as const;

for (const [name, fixture, steps] of cases) {
  test(name, async context => {
    const result = await captureIluScenario({testName: context.name, scenario: 'tuiInteraction', command: captureCommand, viewport: {cols: 80, rows: 24}, input: {seed: {boards: [{title: 'Launch board', current: true, columns: fixtures[fixture]}]}, steps: [{key: 'CTRL_3'}, ...steps, {screenshot: 'result'}], finish: 'normal-exit'}});
    assert.equal(result.exitCode, 0);
    assertCaptureArtifacts({result, testName: context.name, checkpoints: ['result'], diagnostic: message => context.diagnostic(message)});
  });
}
