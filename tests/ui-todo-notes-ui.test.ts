const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {EventEmitter} = require('node:events');

const repoRoot = path.resolve(__dirname, '..');
require('tsx/cjs');

const Ui = require('../ui/app.tsx');
const {buildReadSnapshot} = require('../ui/read-model');
const {createInitialNotesState, handleNotesCommand} = require('../ui/modules/notes/MainView.tsx');

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
  assert.doesNotMatch(visible(session.output()), /Task details/);
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
