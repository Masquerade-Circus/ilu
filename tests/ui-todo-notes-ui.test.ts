import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import * as __cjsImport104 from 'node:events';
const { EventEmitter } = __cjsImport104;
const repoRoot = path.resolve(import.meta.dirname, '..');
import 'tsx/cjs';
import Ui from '../ui/app.tsx';
import fs from 'node:fs';
import { withTempHome } from '../support/home-sandbox.ts';
import createListModel from '../utils/create-list-model.ts';
import loadDb from '../utils/load-db.ts';
import { dbFilePath } from '../utils/local-paths.ts';
import { createTodoActions } from '../ui/modules/todos/actions.ts';
import { createNoteActions } from '../ui/modules/notes/actions.ts';
import { FakeStdin, FakeStdout, exerciseEditorHeight } from './test-helpers/ui-app.ts';
import {captureCommand, assertCaptureArtifacts} from './test-helpers/terminal-capture-scenarios.ts';
import ClockModel from '../clocks/model.ts';
import * as __cjsImport105 from '../ui/read-model';
const { buildReadSnapshot } = __cjsImport105;
import * as __cjsImport106 from '../ui/modules/notes/MainView.tsx';
const { createInitialNotesState, handleNotesCommand } = __cjsImport106;
function visible(output) {
  return output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
}


function visibleLines(output) {
  return visible(output).split(/\r?\n/);
}

function clickVisibleText(session, text, occurrence = 0) {
  const lines = visibleLines(session.output());
  let seen = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const column = lines[index].indexOf(text);

    if (column < 0) {
      continue;
    }

    if (seen === occurrence) {
      session.clickAt(column + 1, index + 1);
      return;
    }

    seen += 1;
  }

  assert.fail(`expected visible text target "${text}" in:\n${lines.join('\n')}`);
}

function mousePrimaryPressSequence(x, y) {
  return `\x1b[<0;${x};${y}M`;
}

function pressVisibleText(stdin, session, text, occurrence = 0) {
  const lines = visibleLines(session.output());
  let seen = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const column = lines[index].indexOf(text);

    if (column < 0) {
      continue;
    }

    if (seen === occurrence) {
      stdin.send(mousePrimaryPressSequence(column + 1, index + 1));
      return;
    }

    seen += 1;
  }

  assert.fail(`expected visible text target "${text}" in:\n${lines.join('\n')}`);
}

function createInput() {
  const stdin = new EventEmitter();
  stdin.isTTY = true;
  stdin.setRawMode = () => {};
  stdin.resume = () => {};
  stdin.pause = () => {};
  stdin.send = (chunk) => stdin.emit('data', Buffer.from(chunk, 'utf8'));
  return stdin;
}

function snapshot() {
  return {
    todo: {
      title: 'Today',
      currentListId: 1,
      lists: [{id: 1, title: 'Today', current: true}, {id: 2, title: 'Later', current: false}],
      items: [{id: 1, position: 1, text: 'Ship parity', description: 'Keep app shell clean', done: false, labels: ['ui']}],
      remaining: 0
    },
    notes: {
      title: 'Research',
      currentListId: 'n1',
      lists: [{id: 'n1', title: 'Research', current: true}],
      items: [{id: 1, position: 1, text: 'Threat model', description: 'Line 1\nLine 2', labels: ['sec']}],
      remaining: 0
    },
    board: {title: 'Board', columns: [], totalCards: 0},
    clocks: {items: [], remaining: 0}
  };
}

function reorderSnapshot() {
  return {
    todo: {
      title: 'Today',
      currentListId: 1,
      lists: [{id: 1, title: 'Today', current: true}],
      items: [
        {id: 't1', position: 1, text: 'First task', description: '', done: false, labels: []},
        {id: 't2', position: 2, text: 'Second task', description: '', done: false, labels: []},
        {id: 't3', position: 3, text: 'Third task', description: '', done: false, labels: []}
      ],
      remaining: 0
    },
    notes: {
      title: 'Research',
      currentListId: 'n1',
      lists: [{id: 'n1', title: 'Research', current: true}],
      items: [
        {id: 'n1', position: 1, text: 'First note', description: '', labels: []},
        {id: 'n2', position: 2, text: 'Second note', description: '', labels: []},
        {id: 'n3', position: 3, text: 'Third note', description: '', labels: []}
      ],
      remaining: 0
    },
    board: {title: 'Board', columns: [], totalCards: 0},
    clocks: {items: [], remaining: 0}
  };
}

function orderedTextIndex(output, labels) {
  const text = visible(output);
  return labels.map(label => text.indexOf(label));
}



test('Todo UI keeps list management out of the main task surface', async () => {
  const session = await Ui.createHeadlessSession({snapshot: snapshot()});
  const output = visible(session.output());

  assert.doesNotMatch(output, /^Todo$/m);
  assert.doesNotMatch(output, /Current list:/);
  assert.doesNotMatch(output, /Todo lists/);
  assert.doesNotMatch(output, /Use list/);
  assert.doesNotMatch(output, /Rename list/);
  assert.doesNotMatch(output, /Remove list/);
  assert.doesNotMatch(output, /List:/);
  assert.match(output, /Today/);
  assert.match(output, /Later/);
  assert.match(output, /Manage lists/);
  session.destroy();
});

test('Todo UI opens list manager as full-surface overlay with virtualized list actions', async () => {
  const session = await Ui.createHeadlessSession({snapshot: snapshot()});

  session.click('todo-manage-lists');
  const output = visible(session.output());

  assert.match(output, /Todo lists/);
  assert.match(output, /Add list/);
  assert.match(output, /Rename list/);
  assert.match(output, /Delete list/);
  assert.match(output, /Close/);
  assert.doesNotMatch(output, /Use list/);
  session.destroy();
});

test('Todo Enter toggles selected task instead of opening details', async () => {
  const calls = [];
  const session = await Ui.createHeadlessSession({
    snapshot: snapshot(),
    todoActions: {
      markTaskDone(values) {
        calls.push(values);
        return {ok: true};
      }
    }
  });

  session.focus('todo-items');
  session.dispatchKey('ENTER');

  assert.deepEqual(calls, [{position: 1}]);
  assert.equal(session.state().todo.overlay, null);
  session.destroy();
});

test('Todo Shift+Up and Shift+Down persist task order and keep moved task selected', async () => {
  let current = reorderSnapshot();
  const calls = [];
  const session = await Ui.createHeadlessSession({
    buildSnapshot: () => current,
    todoActions: {
      moveTask(values) {
        calls.push(values);
        const items = current.todo.items;
        const from = values.position - 1;
        const to = values.direction === 'up' ? from - 1 : from + 1;
        const [item] = items.splice(from, 1);
        items.splice(to, 0, item);
        current = {
          ...current,
          todo: {
            ...current.todo,
            items: items.map((task, index) => ({...task, position: index + 1}))
          }
        };
        return {ok: true};
      }
    }
  });

  session.focus('todo-items');
  session.dispatchKey('DOWN');
  session.dispatchKey('SHIFT_UP');

  assert.deepEqual(calls, [{position: 2, direction: 'up'}]);
  assert.deepEqual(orderedTextIndex(session.output(), ['Second task', 'First task', 'Third task']).map(index => index >= 0), [true, true, true]);
  assert.ok(orderedTextIndex(session.output(), ['Second task', 'First task', 'Third task']).every((value, index, list) => index === 0 || list[index - 1] < value));
  assert.equal(session.state().todo.selectedTaskPosition, 1);

  session.dispatchKey('SHIFT_DOWN');
  assert.deepEqual(calls, [{position: 2, direction: 'up'}, {position: 1, direction: 'down'}]);
  assert.ok(orderedTextIndex(session.output(), ['First task', 'Second task', 'Third task']).every((value, index, list) => index === 0 || list[index - 1] < value));
  assert.equal(session.state().todo.selectedTaskPosition, 2);
  session.destroy();
});

test('Todo Shift reorder is scoped to task list and no-ops at boundaries', async () => {
  const calls = [];
  const session = await Ui.createHeadlessSession({
    snapshot: reorderSnapshot(),
    todoActions: {
      moveTask(values) {
        calls.push(values);
        return {ok: true};
      }
    }
  });

  session.focus('todo-items');
  session.dispatchKey('SHIFT_UP');
  session.click('todo-add-task');
  session.focus('todo-add-description');
  session.dispatchKey('SHIFT_DOWN');

  assert.deepEqual(calls, []);
  session.destroy();
});

test('Notes UI keeps list management out of the main note surface', async () => {
  const session = await Ui.createHeadlessSession({state: {activeTab: 'Notes'}, snapshot: snapshot()});
  const output = visible(session.output());

  assert.doesNotMatch(output, /^Notes$/m);
  assert.doesNotMatch(output, /Current list:/);
  assert.doesNotMatch(output, /Note lists/);
  assert.doesNotMatch(output, /Use list/);
  assert.doesNotMatch(output, /Rename list/);
  assert.doesNotMatch(output, /Remove list/);
  assert.doesNotMatch(output, /List:/);
  assert.match(output, /Research/);
  assert.match(output, /Manage lists/);
  session.destroy();
});

test('Notes UI opens list manager as full-surface overlay with virtualized list actions', async () => {
  const session = await Ui.createHeadlessSession({state: {activeTab: 'Notes'}, snapshot: snapshot()});

  session.click('note-manage-lists');
  const output = visible(session.output());

  assert.match(output, /Note lists/);
  assert.match(output, /Add list/);
  assert.match(output, /Rename list/);
  assert.match(output, /Delete list/);
  assert.match(output, /Close/);
  assert.doesNotMatch(output, /Use list/);
  session.destroy();
});

test('Notes Shift+Up and Shift+Down persist note order and keep moved note selected', async () => {
  let current = reorderSnapshot();
  const calls = [];
  const session = await Ui.createHeadlessSession({
    state: {activeTab: 'Notes'},
    buildSnapshot: () => current,
    noteActions: {
      moveNote(values) {
        calls.push(values);
        const items = current.notes.items;
        const from = values.position - 1;
        const to = values.direction === 'up' ? from - 1 : from + 1;
        const [item] = items.splice(from, 1);
        items.splice(to, 0, item);
        current = {
          ...current,
          notes: {
            ...current.notes,
            items: items.map((note, index) => ({...note, position: index + 1}))
          }
        };
        return {ok: true};
      }
    }
  });

  session.focus('note-items');
  session.dispatchKey('DOWN');
  session.dispatchKey('SHIFT_UP');

  assert.deepEqual(calls, [{position: 2, direction: 'up'}]);
  assert.ok(orderedTextIndex(session.output(), ['Second note', 'First note', 'Third note']).every((value, index, list) => index === 0 || list[index - 1] < value));
  assert.equal(session.state().notesState.selectedNotePosition, 1);

  session.dispatchKey('SHIFT_DOWN');
  assert.deepEqual(calls, [{position: 2, direction: 'up'}, {position: 1, direction: 'down'}]);
  assert.ok(orderedTextIndex(session.output(), ['First note', 'Second note', 'Third note']).every((value, index, list) => index === 0 || list[index - 1] < value));
  assert.equal(session.state().notesState.selectedNotePosition, 2);
  session.destroy();
});

test('Notes Shift reorder is scoped to note list and no-ops at boundaries', async () => {
  const calls = [];
  const session = await Ui.createHeadlessSession({
    state: {activeTab: 'Notes'},
    snapshot: reorderSnapshot(),
    noteActions: {
      moveNote(values) {
        calls.push(values);
        return {ok: true};
      }
    }
  });

  session.focus('note-items');
  session.dispatchKey('SHIFT_UP');
  session.click('note-add-note');
  session.focus('note-add-content');
  session.dispatchKey('SHIFT_DOWN');

  assert.deepEqual(calls, []);
  session.destroy();
});

test('Todo top list selector uses semantic buttons to switch lists', async () => {
  const calls = [];
  const session = await Ui.createHeadlessSession({
    snapshot: snapshot(),
    todoActions: {
      useList(values) {
        calls.push(values);
        return {ok: true};
      }
    }
  });

  session.click('todo-list-switch-2');

  assert.deepEqual(calls, [{listId: 2}]);
  assert.equal(session.state().todo.selectedListId, 2);
  assert.doesNotMatch(visible(session.output()), /List:/);
  session.destroy();
});

test('Notes top list selector uses semantic buttons to switch lists', async () => {
  const calls = [];
  const session = await Ui.createHeadlessSession({
    state: {activeTab: 'Notes'},
    snapshot: {...snapshot(), notes: {...snapshot().notes, lists: [{id: 'n1', title: 'Research', current: true}, {id: 'n2', title: 'Archive', current: false}]}},
    noteActions: {
      useList(values) {
        calls.push(values);
        return {ok: true};
      }
    }
  });

  session.click('note-list-switch-n2');

  assert.deepEqual(calls, [{listId: 'n2'}]);
  assert.equal(session.state().notesState.selectedListId, 'n2');
  assert.doesNotMatch(visible(session.output()), /List:/);
  session.destroy();
});


test('Todo top list selector preserves local selection when switch action fails', async () => {
  const calls = [];
  const session = await Ui.createHeadlessSession({
    state: {todo: {selectedTaskPosition: 1}},
    snapshot: snapshot(),
    todoActions: {
      useList(values) {
        calls.push(values);
        return {ok: false, error: 'Switch failed'};
      }
    }
  });

  session.click('todo-list-switch-2');

  assert.deepEqual(calls, [{listId: 2}]);
  assert.equal(session.state().todo.selectedListId, 1);
  assert.equal(session.state().todo.selectedTaskPosition, 1);
  assert.match(visible(session.output()), /Switch failed/);
  session.destroy();
});

test('Notes top list selector preserves local selection when switch action fails', async () => {
  const calls = [];
  const session = await Ui.createHeadlessSession({
    state: {activeTab: 'Notes', notesState: {selectedNotePosition: 1}},
    snapshot: {...snapshot(), notes: {...snapshot().notes, lists: [{id: 'n1', title: 'Research', current: true}, {id: 'n2', title: 'Archive', current: false}]}},
    noteActions: {
      useList(values) {
        calls.push(values);
        return {ok: false, error: 'Switch failed'};
      }
    }
  });

  session.click('note-list-switch-n2');

  assert.deepEqual(calls, [{listId: 'n2'}]);
  assert.equal(session.state().notesState.selectedListId, 'n1');
  assert.equal(session.state().notesState.selectedNotePosition, 1);
  assert.match(visible(session.output()), /Switch failed/);
  session.destroy();
});

test('Todo and Notes list selectors render null-id lists but block switch actions', async () => {
  const calls = [];
  const nullIdSnapshot = {
    ...snapshot(),
    todo: {
      ...snapshot().todo,
      currentListId: null,
      lists: [{id: null, title: 'Imported todos', current: true}, {id: 2, title: 'Later', current: false}]
    },
    notes: {
      ...snapshot().notes,
      currentListId: null,
      lists: [{id: null, title: 'Imported notes', current: true}, {id: 'n2', title: 'Archive', current: false}]
    }
  };

  const todoSession = await Ui.createHeadlessSession({
    snapshot: nullIdSnapshot,
    todoActions: {
      useList(values) {
        calls.push(['todo', values]);
        return {ok: true};
      }
    }
  });

  todoSession.click('todo-list-switch-list-1');
  todoSession.click('todo-list-switch-2');

  assert.deepEqual(calls, [['todo', {listId: 2}]]);
  assert.equal(todoSession.state().todo.selectedListId, 2);
  assert.match(visible(todoSession.output()), /Imported todos/);
  todoSession.destroy();

  const notesSession = await Ui.createHeadlessSession({
    state: {activeTab: 'Notes'},
    snapshot: nullIdSnapshot,
    noteActions: {
      useList(values) {
        calls.push(['notes', values]);
        return {ok: true};
      }
    }
  });

  notesSession.click('note-list-switch-list-1');
  notesSession.click('note-list-switch-n2');

  assert.deepEqual(calls, [['todo', {listId: 2}], ['notes', {listId: 'n2'}]]);
  assert.equal(notesSession.state().notesState.selectedListId, 'n2');
  assert.match(visible(notesSession.output()), /Imported notes/);
  notesSession.destroy();
});

test('Notes click selects a note without opening details', async () => {
  const stdin = createInput();
  const session = await Ui.mountInteractiveSession({stdin, stdout: {columns: 80, rows: 24, write() {}}, state: {activeTab: 'Notes'}, snapshot: snapshot()});

  pressVisibleText(stdin, session, 'Threat model');

  assert.doesNotMatch(visible(session.output()), /Note details/);
  session.destroy();
});

test('Todo UI exposes approved empty state and visible actions', async () => {
  const session = await Ui.createHeadlessSession({snapshot: {...snapshot(), todo: {title: 'No todo list yet', currentListId: null, lists: [], items: [], remaining: 0}}});
  const output = visible(session.output());

  assert.match(output, /Todo/);
  assert.match(output, /No tasks yet\. Add a task to get started\./);
  assert.match(output, /Add task/);
  assert.match(output, /Manage lists/);
  assert.doesNotMatch(output, /todo command|adapter|snapshot|runtime|criteria/i);
  session.destroy();
});



test('Todo add task overlay pins Save and Cancel to the overlay bottom', async () => {
  const session = await Ui.createHeadlessSession({cols: 80, rows: 24, snapshot: snapshot()});

  session.click('todo-add-task');

  const lines = visibleLines(session.output());
  const actionRow = lines.findIndex(line => /Save/.test(line) && /Cancel/.test(line));

  assert.notEqual(actionRow, -1, `expected Todo add task actions:\n${lines.join('\n')}`);
  assert.equal(actionRow, 20, `Todo add task actions must render on the last internal overlay row:\n${lines.join('\n')}`);
  assert.equal(lines.filter(line => line.length > 80).length, 0);
  session.destroy();
});

test('Notes add note overlay pins Save and Cancel to the overlay bottom', async () => {
  const session = await Ui.createHeadlessSession({cols: 80, rows: 24, state: {activeTab: 'Notes'}, snapshot: snapshot()});

  session.click('note-add-note');

  const lines = visibleLines(session.output());
  const actionRow = lines.findIndex(line => /Save/.test(line) && /Cancel/.test(line));

  assert.notEqual(actionRow, -1, `expected Notes add note actions:\n${lines.join('\n')}`);
  assert.equal(actionRow, 20, `Notes add note actions must render on the last internal overlay row:\n${lines.join('\n')}`);
  assert.equal(lines.filter(line => line.length > 80).length, 0);
  session.destroy();
});

test('Todo UI opens add validation through visible controls without mutating on blank title', async () => {
  const calls = [];
  const todoActions = {
    addTask(values) {
      calls.push(values);
      return {ok: false, error: 'Task title is required.'};
    }
  };
  const session = await Ui.createHeadlessSession({snapshot: snapshot(), todoActions});

  session.click('todo-add-task');
  session.click('todo-add-save');

  const output = visible(session.output());
  assert.match(output, /Add task/);
  assert.match(output, /Task title is required\./);
  assert.deepEqual(calls, [{title: '', description: ''}]);
  session.destroy();
});

test('Notes UI exposes approved actions and preserves multiline detail display', async () => {
  const session = await Ui.createHeadlessSession({state: {activeTab: 'Notes'}, snapshot: snapshot()});

  session.focus('note-items');
  session.dispatchKey('ENTER');

  const output = visible(session.output());
  assert.match(output, /Note details/);
  assert.match(output, /Note content/);
  assert.match(output, /Line 1/);
  assert.match(output, /Line 2/);
  assert.doesNotMatch(output, /notes command|adapter|snapshot|runtime|criteria/i);
  session.destroy();
});

test('Notes UI uses approved empty state and visible list controls', async () => {
  const session = await Ui.createHeadlessSession({state: {activeTab: 'Notes'}, snapshot: {...snapshot(), notes: {title: 'No notes list yet', currentListId: null, lists: [], items: [], remaining: 0}}});
  const output = visible(session.output());

  assert.match(output, /No notes yet\. Add a note to get started\./);
  assert.match(output, /Manage lists/);
  session.destroy();
});

test('Todo UI can operate on tasks beyond the first four via semantic list navigation', async () => {
  const calls = [];
  const items = Array.from({length: 6}, (_, index) => ({
    id: index + 1,
    position: index + 1,
    text: `Task ${index + 1}`,
    description: `Details ${index + 1}`,
    done: false,
    labels: []
  }));
  const session = await Ui.createHeadlessSession({
    snapshot: {...snapshot(), todo: {...snapshot().todo, items, remaining: 0}},
    todoActions: {
      markTaskDone(values) {
        calls.push(values);
        return {ok: true};
      }
    }
  });

  session.focus('todo-items');
  for (let index = 0; index < 4; index += 1) {
    session.dispatchKey('DOWN');
  }
  session.dispatchKey('ENTER');
  assert.deepEqual(calls, [{position: 5}]);
  assert.doesNotMatch(visible(session.output()), /\+\d+ more/);
  session.destroy();
});

test('Notes UI preserves content when editing a note beyond the first four', async () => {
  const calls = [];
  const items = Array.from({length: 6}, (_, index) => ({
    id: index + 1,
    position: index + 1,
    text: `Note ${index + 1}`,
    description: `Body ${index + 1}`,
    labels: []
  }));
  const session = await Ui.createHeadlessSession({
    state: {activeTab: 'Notes'},
    snapshot: {...snapshot(), notes: {...snapshot().notes, items, remaining: 0}},
    noteActions: {
      editNote(values) {
        calls.push(values);
        return {ok: true};
      }
    }
  });

  session.focus('note-items');
  for (let index = 0; index < 4; index += 1) {
    session.dispatchKey('DOWN');
  }
  session.focus('note-items');
  session.dispatchKey('ENTER');
  session.click('note-edit-note');
  session.click('note-edit-save');

  assert.deepEqual(calls, [{position: 5, title: 'Note 5', content: 'Body 5'}]);
  assert.doesNotMatch(visible(session.output()), /\+\d+ more/);
  session.destroy();
});


test('Notes UI preserves exact model content through snapshot edit save', async () => {
  const exactContent = '\n  const value = 1;\n\n    return value;\n';
  const calls = [];
  const snapshotFromModel = buildReadSnapshot({
    models: {
      todos: {getCurrent: () => ({title: 'Today', tasks: []}), getFirst: () => null},
      notes: {
        getCurrent: () => ({title: 'Research', notes: [{title: 'Snippet', content: exactContent}]}),
        getFirst: () => null
      },
      boards: {getCurrent: () => null, getFirst: () => null},
      clocks: {find: () => []}
    }
  });

  const session = await Ui.createHeadlessSession({
    state: {activeTab: 'Notes'},
    snapshot: snapshotFromModel,
    noteActions: {
      editNote(values) {
        calls.push(values);
        return {ok: true};
      }
    }
  });

  session.focus('note-items');
  session.dispatchKey('ENTER');
  session.click('note-edit-note');
  session.click('note-edit-save');

  assert.deepEqual(calls, [{position: 1, title: 'Snippet', content: exactContent}]);
  session.destroy();
});

test('Todo visible action copy uses Reopen task for completed tasks', async () => {
  const session = await Ui.createHeadlessSession({
    state: {todo: {selectedTaskPosition: 1, overlay: 'task-details'}},
    snapshot: {...snapshot(), todo: {...snapshot().todo, items: [{...snapshot().todo.items[0], done: true}], remaining: 0}}
  });
  const output = visible(session.output());

  assert.match(output, /Reopen task/);
  assert.doesNotMatch(output, /Mark open/);
  session.destroy();
});



test('Todo list switch resets stale task selection before the next task action', async () => {
  const calls = [];
  let currentListId = 1;
  const todoByList = {
    1: {
      title: 'Today',
      currentListId: 1,
      lists: [{id: 1, title: 'Today', current: true}, {id: 2, title: 'Later', current: false}],
      items: Array.from({length: 5}, (_, index) => ({
        id: index + 1,
        position: index + 1,
        text: `Task ${index + 1}`,
        description: '',
        done: false,
        labels: []
      })),
      remaining: 0
    },
    2: {
      title: 'Later',
      currentListId: 2,
      lists: [{id: 1, title: 'Today', current: false}, {id: 2, title: 'Later', current: true}],
      items: [{id: 20, position: 1, text: 'Later task', description: '', done: false, labels: []}],
      remaining: 0
    }
  };

  const makeSnapshot = () => ({...snapshot(), todo: todoByList[currentListId]});
  const session = await Ui.createHeadlessSession({
    buildSnapshot: makeSnapshot,
    todoActions: {
      useList(values) {
        currentListId = values.listId;
        return {ok: true};
      },
      markTaskDone(values) {
        calls.push(values);
        return {ok: true};
      }
    }
  });

  session.focus('todo-items');
  for (let index = 0; index < 4; index += 1) {
    session.dispatchKey('DOWN');
  }
  clickVisibleText(session, 'Later');
  session.focus('todo-items');
  session.dispatchKey('ENTER');

  assert.deepEqual(calls, [{position: 1}]);
  assert.equal(session.state().todo.selectedTaskPosition, 1);
  session.destroy();
});

test('Notes list switch resets stale note selection and Enter requires an active note', async () => {
  let currentListId = 'n1';
  const notesByList = {
    n1: {
      title: 'Research',
      currentListId: 'n1',
      lists: [{id: 'n1', title: 'Research', current: true}, {id: 'n2', title: 'Archive', current: false}],
      items: Array.from({length: 5}, (_, index) => ({
        id: index + 1,
        position: index + 1,
        text: `Note ${index + 1}`,
        description: `Body ${index + 1}`,
        labels: []
      })),
      remaining: 0
    },
    n2: {
      title: 'Archive',
      currentListId: 'n2',
      lists: [{id: 'n1', title: 'Research', current: false}, {id: 'n2', title: 'Archive', current: true}],
      items: [],
      remaining: 0
    }
  };

  const makeSnapshot = () => ({...snapshot(), notes: notesByList[currentListId]});
  const session = await Ui.createHeadlessSession({
    state: {activeTab: 'Notes'},
    buildSnapshot: makeSnapshot,
    noteActions: {
      useList(values) {
        currentListId = values.listId;
        return {ok: true};
      }
    }
  });

  session.focus('note-items');
  for (let index = 0; index < 4; index += 1) {
    session.dispatchKey('DOWN');
  }
  clickVisibleText(session, 'Archive');
  session.focus('note-items');
  session.dispatchKey('ENTER');

  assert.equal(session.state().notesState.selectedNotePosition, null);
  assert.doesNotMatch(visible(session.output()), /Note details/);
  session.destroy();

  const staleState = createInitialNotesState({selectedNotePosition: 5});
  const handled = handleNotesCommand(
    {id: 'notes.open-details'},
    staleState,
    true,
    {focusedId: 'note-items'},
    {items: [{id: 1, position: 1, text: 'Fresh note', description: '', labels: []}], lists: []}
  );

  assert.equal(handled, true);
  assert.equal(staleState.overlay, null);
  assert.equal(staleState.actionError, 'Choose a note first.');
});

test('Todo and Notes list selectors delegate long labels to Valyrian without manual ellipsis', async () => {
  const longTodoTitle = 'Today list with an absurdly long title that used to punch through the panel width';
  const longNoteTitle = 'Research list with an absurdly long title that used to punch through the panel width';
  const longSnapshot = {
    ...snapshot(),
    todo: {
      ...snapshot().todo,
      lists: [{id: 1, title: longTodoTitle, current: true}, {id: 2, title: 'Later', current: false}]
    },
    notes: {
      ...snapshot().notes,
      lists: [{id: 'n1', title: longNoteTitle, current: true}, {id: 'n2', title: 'Archive', current: false}]
    }
  };

  const todoSession = await Ui.createHeadlessSession({cols: 80, rows: 24, snapshot: longSnapshot});
  const todoOutput = visible(todoSession.output());
  assert.match(todoOutput, /Today list with an absurdly long title/);
  assert.doesNotMatch(todoOutput, /Today list with a…/);
  assert.ok(visibleLines(todoSession.output()).every((line) => line.length <= 80));
  todoSession.destroy();

  const notesSession = await Ui.createHeadlessSession({cols: 80, rows: 24, state: {activeTab: 'Notes'}, snapshot: longSnapshot});
  const notesOutput = visible(notesSession.output());
  assert.match(notesOutput, /Research list with an absurdly long title/);
  assert.doesNotMatch(notesOutput, /Research list wit…/);
  assert.ok(visibleLines(notesSession.output()).every((line) => line.length <= 80));
  notesSession.destroy();
});

for (const domain of [
  { tab: 'Todo', db: 'todos', key: 'tasks', prefix: 'todo', stateKey: 'todo' },
  { tab: 'Notes', db: 'notes', key: 'notes', prefix: 'note', stateKey: 'notesState' }
]) {
  test(`${domain.tab} rename through the TUI preserves stored list details`, async () => {
    await withTempHome(async () => {
      const model = createListModel({dbName: domain.db, collectionName: domain.db, itemKey: domain.key, itemHasCheck: domain.tab === 'Todo'});
      const original = model.add({title: 'Project', description: 'Keep these details\nSecond line'});
      const session = await Ui.createHeadlessSession({
        state: {activeTab: domain.tab},
        buildSnapshot: () => buildReadSnapshot({models: {...realListModels(), [domain.db]: model}}),
        ...domainActions(domain, model)
      });

      try {
        session.click(`${domain.prefix}-manage-lists`);
        session.click(`${domain.prefix}-rename-list`);
        session.focus(`${domain.prefix}-rename-list-title`);
        session.dispatchKey('CTRL_A');
        session.dispatchText('Renamed project');
        session.click(`${domain.prefix}-rename-list-save`);

        const saved = loadDb(domain.db).getCollection(domain.db).get(original.$id);
        assert.equal(saved.title, 'Renamed project');
        assert.equal(saved.description, 'Keep these details\nSecond line');
      } finally {
        await session.destroy();
      }
    });
  });

  test(`${domain.tab} browsing list manager does not change the active list`, async () => {
    await withTempHome(async () => {
      const model = createListModel({dbName: domain.db, collectionName: domain.db, itemKey: domain.key});
      const first = model.add({title: 'First list', description: 'First details'});
      const second = model.add({title: 'Second list', description: 'Second details'});
      model.use(first.$id);
      const session = await Ui.createHeadlessSession({
        state: {activeTab: domain.tab},
        buildSnapshot: () => buildReadSnapshot({models: {...realListModels(), [domain.db]: model}}),
        ...domainActions(domain, model)
      });

      try {
        session.click(`${domain.prefix}-manage-lists`);
        session.focus(`${domain.prefix}-lists`);
        session.dispatchKey('DOWN');
        session.dispatchKey('ESCAPE');

        assert.equal(model.getCurrent().$id, first.$id);
        assert.equal(session.state()[domain.stateKey].selectedListId, first.$id);

        session.click(`${domain.prefix}-manage-lists`);
        session.focus(`${domain.prefix}-lists`);
        session.dispatchKey('HOME');
        session.dispatchKey('DOWN');
        session.click(`${domain.prefix}-rename-list`);
        session.focus(`${domain.prefix}-rename-list-title`);
        session.dispatchKey('CTRL_A');
        session.dispatchText('Second renamed');
        session.click(`${domain.prefix}-rename-list-save`);

        assert.equal(model.get(second.$id).title, 'Second renamed');
        assert.equal(model.get(first.$id).title, 'First list');
        assert.equal(model.getCurrent().$id, first.$id);
      } finally {
        await session.destroy();
      }
    });
  });

  for (const target of ['item', 'list', 'changed-item', 'vanished-list']) {
    test(`${domain.tab} failed ${target} removal stays identified and can retry or cancel`, async () => {
      await withTempHome(async () => {
        const model = createListModel({dbName: domain.db, collectionName: domain.db, itemKey: domain.key, itemHasCheck: domain.tab === 'Todo'});
        const list = model.add({title: 'Keep list', description: 'Original'});
        model[domain.key].add({title: 'Keep item', description: 'Task details', content: 'Note body'});
        if (target === 'vanished-list') {
          model.add({title: 'Other list', description: 'Must survive'});
          model.use(list.$id);
        }
        const stdin = createInput();
        const session = await Ui.mountInteractiveSession({
          stdin,
          stdout: {columns: 100, rows: 28, write() {}},
          state: {activeTab: domain.tab},
          buildSnapshot: () => buildReadSnapshot({models: {...realListModels(), [domain.db]: model}}),
          ...domainActions(domain, model)
        });

        try {
          if (target.endsWith('list')) {
            session.click(`${domain.prefix}-manage-lists`);
            session.click(`${domain.prefix}-delete-list`);
          } else {
            // Use the existing pointer path. The keyboard-details regression is separate.
            pressVisibleText(stdin, session, 'Keep item');
            pressVisibleText(stdin, session, 'Keep item');
            session.click(`${domain.prefix}-remove-${domain.tab === 'Todo' ? 'task' : 'note'}`);
          }

          const external = loadDb(domain.db).getCollection(domain.db);
          const externalList = external.get(list.$id);
          if (target === 'vanished-list') {
            external.remove(externalList);
          } else {
            external.update({...externalList, description: 'External edit', ...(target === 'changed-item' ? {
              [domain.key]: [{title: 'Different item', description: 'Different', content: 'Different', done: false, labels: []}, ...externalList[domain.key]]
            } : {})});
          }
          const before = fs.readFileSync(dbFilePath(domain.db), 'utf8');
          const confirmId = `${domain.prefix}-remove-${target.endsWith('list') ? 'list-' : ''}confirm`;
          const cancelId = `${domain.prefix}-remove-${target.endsWith('list') ? 'list-' : ''}cancel`;
          session.click(confirmId);

          if (target === 'vanished-list') {
            await new Promise(resolve => setImmediate(resolve));
            assert.ok(visible(session.output()).includes('Keep list'), 'the original target must remain visible after recovery');
            assert.match(visible(session.output()), /no longer|unavailable|removed/i);
            assert.equal(session.focus(cancelId), true, 'cancel must remain available');
            session.click(confirmId);
            assert.equal(fs.readFileSync(dbFilePath(domain.db), 'utf8'), before, 'retry must not delete the surviving list');
            session.click(cancelId);
            assert.equal(session.focus(cancelId), false);
            assert.equal(fs.readFileSync(dbFilePath(domain.db), 'utf8'), before);
            assert.equal(loadDb(domain.db).getCollection(domain.db).find()[0].title, 'Other list');
            return;
          }

          assert.match(visible(session.output()), /(?:recover|changed elsewhere|failed|could not|try again)/i);
          assert.ok(visible(session.output()).includes(target === 'list' ? 'Keep list' : 'Keep item'));
          assert.equal(fs.readFileSync(dbFilePath(domain.db), 'utf8'), before);
          if (target === 'changed-item') {
            await new Promise(resolve => setImmediate(resolve));
            session.click(confirmId);
            assert.equal(fs.readFileSync(dbFilePath(domain.db), 'utf8'), before, 'a retry must not remove a different item after recovery');
          }
          session.click(cancelId);
          assert.equal(session.focus(confirmId), false);
          assert.equal(fs.readFileSync(dbFilePath(domain.db), 'utf8'), before);
          if (target === 'changed-item') {
            return;
          }

          // Recovery reloads the real model. Retry through the same visible flow.
          await new Promise(resolve => setImmediate(resolve));
          if (target === 'list') {
            session.click(`${domain.prefix}-manage-lists`);
            session.click(`${domain.prefix}-delete-list`);
          } else {
            pressVisibleText(stdin, session, 'Keep item');
            pressVisibleText(stdin, session, 'Keep item');
            session.click(`${domain.prefix}-remove-${domain.tab === 'Todo' ? 'task' : 'note'}`);
          }
          session.click(confirmId);
          const persisted = loadDb(domain.db).getCollection(domain.db);
          if (target === 'list') {
            assert.equal(persisted.find().length, 0);
          } else {
            assert.equal(persisted.get(list.$id)[domain.key].length, 0);
          }
        } finally {
          await session.destroy();
        }
      });
    });
  }
}

function realListModels() {
  return {
    todos: createListModel({dbName: 'todos', collectionName: 'todos', itemKey: 'tasks', itemHasCheck: true}),
    notes: createListModel({dbName: 'notes', collectionName: 'notes', itemKey: 'notes'}),
    boards: createListModel({dbName: 'boards', collectionName: 'boards', itemKey: 'columns'}),
    clocks: ClockModel
  };
}

function domainActions(domain, model) {
  return domain.tab === 'Todo'
    ? {todoActions: createTodoActions({model})}
    : {noteActions: createNoteActions({model})};
}

test('physical capture Notes list, selector, manager and editor preserve real navigation and cancel', async context => {
  const {captureIluScenario} = await import('./test-helpers/terminal-capture.ts');
  const result = await captureIluScenario({scenario: 'notesFocus', command: captureCommand, viewport: {cols: 80, rows: 24}});
  assert.equal(result.exitCode, 0);
  assertCaptureArtifacts({result, checkpoints: ['notes-list', 'notes-selector-focus', 'notes-list-focus', 'notes-manager', 'notes-editor-focus'], diagnostic: message => context.diagnostic(message)});
});

for (const domain of ['Todo', 'Notes']) {
  test(`physical capture ${domain} editor preserves resize, cancellation and multiline persistence`, async context => {
    const {captureIluScenario} = await import('./test-helpers/terminal-capture.ts');
    const result = await captureIluScenario({scenario: 'listEditor', input: {domain}, command: captureCommand, viewport: {cols: 80, rows: 24}});
    assert.equal(result.exitCode, 0);
    assertCaptureArtifacts({result, checkpoints: ['editor-1', 'editor-2', 'editor-3', 'editor-edited', 'editor-saved'], diagnostic: message => context.diagnostic(message)});
  });
}

for (const domain of [
  {tab: 'Todo', db: 'todos', key: 'tasks', prefix: 'todo', item: 'task'},
  {tab: 'Notes', db: 'notes', key: 'notes', prefix: 'note', item: 'note'}
]) {
  for (const form of ['add-item', 'edit-item', 'add-list', 'rename-list']) {
    test(`${domain.tab} ${form} editor uses available height across resize without losing cancel or save`, async () => {
      await withTempHome(async () => {
        const model = createListModel({dbName: domain.db, collectionName: domain.db, itemKey: domain.key, itemHasCheck: domain.tab === 'Todo'});
        const original = model.add({title: 'Seed list', description: ''});
        model[domain.key].add({title: 'Seed item', description: '', content: ''});
        const before = fs.readFileSync(dbFilePath(domain.db), 'utf8');
        const models = {...realListModels(), [domain.db]: model};
        const stdin = new FakeStdin();
        const stdout = new FakeStdout();
        stdout.columns = 100;
        const session = await Ui.mountInteractiveSession({
          stdin, stdout,
          state: {activeTab: domain.tab},
          buildSnapshot: () => buildReadSnapshot({models}),
          ...domainActions(domain, model)
        });
        const isList = form.endsWith('list');
        const idPrefix = `${domain.prefix}-${isList ? form : form.startsWith('add') ? 'add' : 'edit'}`;

        try {
          for (const outcome of ['cancel', 'save']) {
            if (isList) {
              session.click(`${domain.prefix}-manage-lists`);
              session.click(`${domain.prefix}-${form}`);
            } else if (form === 'add-item') {
              session.click(`${domain.prefix}-add-${domain.item}`);
            } else {
              pressVisibleText(stdin, session, 'Seed item');
              pressVisibleText(stdin, session, 'Seed item');
              session.click(`${domain.prefix}-edit-${domain.item}`);
            }
            assert.equal(session.focus(`${idPrefix}-title`), true);
            session.dispatchKey('CTRL_A');
            stdin.send('\x1b[200~Draft title\x1b[201~');
            const text = await exerciseEditorHeight({
              session, stdin, stdout,
              editorId: `${idPrefix}-${!isList && domain.tab === 'Notes' ? 'content' : 'description'}`,
              followingControl: /Cancel/,
              requiredText: [/Draft title/, /Cancel/, isList ? form === 'add-list' ? /Add list/ : /Rename list/ : /Save/]
            });

            // Click the visible action, so a clipped but focusable control cannot pass.
            const actionText = outcome === 'cancel' ? 'Cancel' : isList ? form === 'add-list' ? 'Add list' : 'Rename list' : 'Save';
            const lines = visibleLines(session.output());
            const actionRow = lines.findIndex(line => line.includes('Cancel') && line.includes(actionText));
            assert.ok(actionRow >= 0, 'the form actions must remain visible after resize');
            session.clickAt(lines[actionRow].indexOf(actionText) + 1, actionRow + 1);
            if (outcome === 'cancel') {
              assert.equal(fs.readFileSync(dbFilePath(domain.db), 'utf8'), before, 'cancel after resize must not persist drafts');
            } else {
              const lists = loadDb(domain.db).getCollection(domain.db).find();
              const saved = isList ? lists.find(list => list.title === 'Draft title') : lists.find(list => list.$id === original.$id)[domain.key].find(item => item.title === 'Draft title');
              assert.ok(saved, 'save after resize must persist the edited target');
              assert.equal(isList || domain.tab === 'Todo' ? saved.description : saved.content, text);
            }
          }
        } finally {
          await session.destroy();
        }
      });
    });
  }
}

test('Todo keyboard details preserves completion until Enter or Space toggles it', async () => {
  await withTempHome(async () => {
    const model = createListModel({dbName: 'todos', collectionName: 'todos', itemKey: 'tasks', itemHasCheck: true});
    model.add({title: 'Work'});
    model.tasks.add({title: 'Release', description: 'Release checklist', done: false});
    const session = await Ui.createHeadlessSession({
      buildSnapshot: () => buildReadSnapshot({models: {...realListModels(), todos: model}}),
      todoActions: createTodoActions({model})
    });
    try {
      session.focus('todo-items');
      // Follow the advertised contextual key instead of fixing a new shortcut in the test.
      session.dispatchKey('CTRL_K');
      const help = visible(session.output());
      const detailsHint = help.split('\n').find(line => /\b(?:open|show|view)\b[^\n]*\bdetails\b/i.test(line));
      const key = detailsHint?.match(/\b((?:(?:Ctrl|Shift|Alt)\+)*[A-Z0-9])\b/);
      assert.ok(key, 'help must advertise a keyboard action for task details');
      session.dispatchKey('ESCAPE');
      session.focus('todo-items');
      session.dispatchKey(key[1].replace(/\+/g, '_').toUpperCase());
      assert.ok(visible(session.output()).includes('Release checklist'));
      assert.equal(model.getCurrent().tasks[0].done, false);
      session.dispatchKey('ESCAPE');
      session.focus('todo-items');
      session.dispatchKey('ENTER');
      assert.equal(model.getCurrent().tasks[0].done, true);
      session.dispatchKey('SPACE');
      assert.equal(model.getCurrent().tasks[0].done, false);
    } finally {
      await session.destroy();
    }
  });
});

for (const tab of ['Todo', 'Notes']) {
  test(`${tab} tall terminal shows more list entries without hiding actions`, async () => {
    const data = snapshot();
    const panel = tab === 'Todo' ? data.todo : data.notes;
    panel.items = Array.from({length: 24}, (_, index) => ({
      id: index + 1, position: index + 1, text: `Entry-${index + 1}-end`, description: '', done: false, labels: []
    }));
    const small = await Ui.createHeadlessSession({cols: 100, rows: 24, state: {activeTab: tab}, snapshot: data});
    const large = await Ui.createHeadlessSession({cols: 100, rows: 40, state: {activeTab: tab}, snapshot: data});
    try {
      const count = session => (visible(session.output()).match(/Entry-\d+-end/g) || []).length;
      assert.ok(count(large) > count(small), 'additional height must expose additional entries');
      for (const session of [small, large]) {
        assert.ok(session.focus(tab === 'Todo' ? 'todo-manage-lists' : 'note-manage-lists'));
        session.dispatchKey('ENTER');
        assert.ok(session.focus(tab === 'Todo' ? 'todo-lists-close' : 'note-lists-close'));
      }
    } finally {
      await small.destroy();
      await large.destroy();
    }
  });
}
