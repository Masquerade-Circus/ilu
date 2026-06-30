import test from 'node:test';
import assert from 'node:assert/strict';
import * as __cjsImport103 from '../ui/modules/todos/actions';

const { createTodoActions } = __cjsImport103;
function createTodoModel() {
  const calls = [];
  const lists = [
    {$id: 1, index: 1, title: 'Today', description: 'Now', current: true, labels: [], tasks: [
      {title: 'Open task', description: 'Ship', done: false, labels: [{title: 'work'}]},
      {title: 'Done task', description: '', done: true, labels: []}
    ]},
    {$id: 2, index: 2, title: 'Later', description: '', current: false, labels: [], tasks: []}
  ];

  const model = {
    find() {
      return lists;
    },
    findOne(query: any = {}) {
      if (Object.prototype.hasOwnProperty.call(query, 'index')) {
        return lists.find(list => list.index === query.index);
      }

      return lists.find(list => list.current === true);
    },
    getCurrent() {
      return lists.find(list => list.current === true);
    },
    getFirst() {
      return lists[0];
    },
    get(id) {
      return lists.find(list => list.$id === id);
    },
    add(values) {
      calls.push(['add-list', values]);
      const item = {$id: lists.length + 1, index: lists.length + 1, current: false, labels: [], tasks: [], ...values};
      lists.push(item);
      return item;
    },
    save(item) {
      calls.push(['save-list', item.index, item.title, item.description]);
      return item;
    },
    use(id) {
      calls.push(['use-list', id]);
      lists.forEach(list => {
        list.current = list.$id === id;
      });
      return lists.find(list => list.current === true);
    },
    remove(item) {
      calls.push(['remove-list', item && item.index]);
      const index = lists.findIndex(list => list.$id === item.$id);
      if (index >= 0) {
        lists.splice(index, 1);
      }
      lists.forEach((list, offset) => {
        list.index = offset + 1;
      });
    },
    tasks: {
      add(values) {
        calls.push(['add-task', values]);
        model.getCurrent().tasks.push({done: false, labels: [], ...values});
        return values;
      },
      edit(position, values) {
        calls.push(['edit-task', position, values]);
        Object.assign(model.getCurrent().tasks[position - 1], values);
        return model.getCurrent().tasks[position - 1];
      },
      check(checked) {
        calls.push(['check-task', checked]);
        model.getCurrent().tasks.forEach((task, index) => {
          task.done = checked.includes(index);
        });
        return model.getCurrent();
      },
      remove(position) {
        calls.push(['remove-task', position]);
        model.getCurrent().tasks.splice(position - 1, 1);
        return model.getCurrent();
      },
      reorder(values) {
        calls.push(['reorder-task', values]);
        const from = values.fromIndex - 1;
        const to = values.toIndex - 1;
        const [task] = model.getCurrent().tasks.splice(from, 1);
        model.getCurrent().tasks.splice(to, 0, task);
        return model.getCurrent();
      }
    }
  };

  return {model, calls, lists};
}

test('Todo adapter rejects invalid task input before model calls', () => {
  const {model, calls} = createTodoModel();
  const actions = createTodoActions({model});

  assert.deepEqual(actions.addTask({title: '   ', description: 'x'}), {ok: false, error: 'Task title is required.'});
  assert.deepEqual(actions.editTask({position: 0, title: 'x'}), {ok: false, error: 'Choose a task first.'});
  assert.deepEqual(actions.markTaskDone({position: -1}), {ok: false, error: 'Choose a task first.'});
  assert.deepEqual(actions.removeTask({position: Number.NaN}), {ok: false, error: 'Choose a task first.'});
  assert.deepEqual(calls, []);
});

test('Todo adapter rejects invalid reorder requests before model calls', () => {
  const {model, calls} = createTodoModel();
  const actions = createTodoActions({model});

  assert.deepEqual(actions.moveTask({position: 1, direction: 'up'}), {ok: true});
  assert.deepEqual(actions.moveTask({position: 2, direction: 'sideways'}), {ok: false, error: 'Choose a move direction.'});
  assert.deepEqual(actions.moveTask({position: Number.NaN, direction: 'down'}), {ok: false, error: 'Choose a task first.'});

  assert.deepEqual(calls, []);
});

test('Todo adapter reorders tasks through the model and treats end boundaries as no-ops', () => {
  const {model, calls, lists} = createTodoModel();
  const actions = createTodoActions({model});

  assert.equal(actions.moveTask({position: 2, direction: 'up'}).ok, true);
  assert.equal(actions.moveTask({position: 2, direction: 'down'}).ok, true);
  assert.equal(actions.moveTask({position: 2, toPosition: 1}).ok, true);

  assert.deepEqual(calls, [
    ['reorder-task', {fromIndex: 2, toIndex: 1}],
    ['reorder-task', {fromIndex: 2, toIndex: 1}]
  ]);
  assert.deepEqual(lists[0].tasks.map(task => task.title), ['Open task', 'Done task']);
});

test('Todo adapter calls model task APIs with trimmed values and preserves labels when editing', () => {
  const {model, calls, lists} = createTodoModel();
  const actions = createTodoActions({model});

  assert.equal(actions.addTask({title: '  Add UI  ', description: '  Details  '}).ok, true);
  assert.equal(actions.editTask({position: 1, title: '  Edited  ', description: '  New desc  '}).ok, true);
  assert.equal(actions.markTaskDone({position: 1}).ok, true);
  assert.equal(actions.markTaskOpen({position: 2}).ok, true);
  assert.equal(actions.removeTask({position: 1}).ok, true);

  assert.deepEqual(calls, [
    ['add-task', {title: 'Add UI', description: 'Details'}],
    ['edit-task', 1, {title: 'Edited', description: 'New desc'}],
    ['check-task', [0, 1]],
    ['check-task', [0]],
    ['remove-task', 1]
  ]);
  assert.deepEqual(lists[0].tasks[0].labels, []);
});

test('Todo adapter supports list use add rename remove with current-list fallback', () => {
  const {model, calls, lists} = createTodoModel();
  const actions = createTodoActions({model});

  assert.equal(actions.useList({listId: 2}).ok, true);
  assert.equal(actions.addList({title: '  Inbox  ', description: '  Capture  '}).ok, true);
  assert.equal(actions.renameList({listId: 2, title: '  Later renamed  ', description: '  Queue  '}).ok, true);
  assert.equal(actions.removeList({listId: 2}).ok, true);

  assert.deepEqual(calls, [
    ['use-list', 2],
    ['add-list', {title: 'Inbox', description: 'Capture'}],
    ['save-list', 2, 'Later renamed', 'Queue'],
    ['remove-list', 2],
    ['use-list', 1]
  ]);
  assert.equal(lists[0].current, true);
});

test('Todo adapter converts thrown model failures into safe copy', () => {
  const actions = createTodoActions({model: {getCurrent() { throw new Error('db failed at /home/user/token stack'); }}});

  const result = actions.addTask({title: 'Task'});

  assert.equal(result.ok, false);
  assert.equal(result.error, 'Task could not be saved. Try again.');
  assert.doesNotMatch(result.error, /\/home|token|stack/i);
});
