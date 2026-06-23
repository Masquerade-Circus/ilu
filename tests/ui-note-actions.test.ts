const test = require('node:test');
const assert = require('node:assert/strict');

const {createNoteActions} = require('../ui/note-actions');

function createNoteModel() {
  const calls = [];
  const lists = [
    {$id: 'n1', index: 1, title: 'Research', description: 'Ideas', current: true, labels: [], notes: [
      {title: 'Threat model', content: 'Line 1\nLine 2', labels: [{title: 'sec'}]},
      {title: 'Abuse cases', content: 'Boundaries', labels: []}
    ]},
    {$id: 'n2', index: 2, title: 'Archive', description: '', current: false, labels: [], notes: []}
  ];
  const model = {
    find: () => lists,
    findOne(query: any = {}) {
      if (Object.prototype.hasOwnProperty.call(query, 'index')) {
        return lists.find(list => list.index === query.index);
      }

      return lists.find(list => list.current === true);
    },
    getCurrent: () => lists.find(list => list.current === true),
    getFirst: () => lists[0],
    get: id => lists.find(list => list.$id === id),
    add(values) {
      calls.push(['add-list', values]);
      const item = {$id: `n${lists.length + 1}`, index: lists.length + 1, current: false, labels: [], notes: [], ...values};
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
    notes: {
      add(values) {
        calls.push(['add-note', values]);
        model.getCurrent().notes.push({labels: [], ...values});
        return values;
      },
      edit(position, values) {
        calls.push(['edit-note', position, values]);
        Object.assign(model.getCurrent().notes[position - 1], values);
        return model.getCurrent().notes[position - 1];
      },
      remove(position) {
        calls.push(['remove-note', position]);
        model.getCurrent().notes.splice(position - 1, 1);
        return model.getCurrent();
      },
      reorder(values) {
        calls.push(['reorder-note', values]);
        const from = values.fromIndex - 1;
        const to = values.toIndex - 1;
        const [note] = model.getCurrent().notes.splice(from, 1);
        model.getCurrent().notes.splice(to, 0, note);
        return model.getCurrent();
      }
    }
  };

  return {model, calls, lists};
}

test('Notes adapter rejects invalid note input before model calls', () => {
  const {model, calls} = createNoteModel();
  const actions = createNoteActions({model});

  assert.deepEqual(actions.addNote({title: '', content: 'Body'}), {ok: false, error: 'Note title is required.'});
  assert.deepEqual(actions.editNote({position: 0, title: 'Title', content: 'Body'}), {ok: false, error: 'Choose a note first.'});
  assert.deepEqual(actions.removeNote({position: null}), {ok: false, error: 'Choose a note first.'});
  assert.deepEqual(calls, []);
});

test('Notes adapter rejects invalid reorder requests before model calls', () => {
  const {model, calls} = createNoteModel();
  const actions = createNoteActions({model});

  assert.deepEqual(actions.moveNote({position: 1, direction: 'up'}), {ok: true});
  assert.deepEqual(actions.moveNote({position: 2, direction: 'sideways'}), {ok: false, error: 'Choose a move direction.'});
  assert.deepEqual(actions.moveNote({position: null, direction: 'down'}), {ok: false, error: 'Choose a note first.'});

  assert.deepEqual(calls, []);
});

test('Notes adapter reorders notes through the model and treats end boundaries as no-ops', () => {
  const {model, calls, lists} = createNoteModel();
  const actions = createNoteActions({model});

  assert.equal(actions.moveNote({position: 2, direction: 'up'}).ok, true);
  assert.equal(actions.moveNote({position: 2, direction: 'down'}).ok, true);
  assert.equal(actions.moveNote({position: 2, toPosition: 1}).ok, true);

  assert.deepEqual(calls, [
    ['reorder-note', {fromIndex: 2, toIndex: 1}],
    ['reorder-note', {fromIndex: 2, toIndex: 1}]
  ]);
  assert.deepEqual(lists[0].notes.map(note => note.title), ['Threat model', 'Abuse cases']);
});

test('Notes adapter preserves multiline content and calls model APIs', () => {
  const {model, calls, lists} = createNoteModel();
  const actions = createNoteActions({model});

  assert.equal(actions.addNote({title: '  New note  ', content: 'Line A\nLine B'}).ok, true);
  assert.equal(actions.editNote({position: 1, title: '  Edited  ', content: 'First\nSecond'}).ok, true);
  assert.equal(actions.removeNote({position: 2}).ok, true);

  assert.deepEqual(calls, [
    ['add-note', {title: 'New note', content: 'Line A\nLine B'}],
    ['edit-note', 1, {title: 'Edited', content: 'First\nSecond'}],
    ['remove-note', 2]
  ]);
  assert.deepEqual(lists[0].notes[0].labels, [{title: 'sec'}]);
});

test('Notes adapter supports note list management and fallback current list', () => {
  const {model, calls, lists} = createNoteModel();
  const actions = createNoteActions({model});

  assert.equal(actions.useList({listId: 'n2'}).ok, true);
  assert.equal(actions.addList({title: '  Scratch  ', description: '  Drafts  '}).ok, true);
  assert.equal(actions.renameList({listId: 'n2', title: '  Archive renamed  ', description: ''}).ok, true);
  assert.equal(actions.removeList({listId: 'n2'}).ok, true);

  assert.deepEqual(calls, [
    ['use-list', 'n2'],
    ['add-list', {title: 'Scratch', description: 'Drafts'}],
    ['save-list', 2, 'Archive renamed', ''],
    ['remove-list', 2],
    ['use-list', 'n1']
  ]);
  assert.equal(lists[0].current, true);
});

test('Notes adapter returns safe errors without leaking internal details', () => {
  const actions = createNoteActions({model: {getCurrent() { throw new Error('provider path /home/me/.config/token stack'); }}});

  const result = actions.addNote({title: 'Note', content: 'Body'});

  assert.equal(result.ok, false);
  assert.equal(result.error, 'Note could not be saved. Try again.');
  assert.doesNotMatch(result.error, /provider|\/home|token|stack/i);
});
