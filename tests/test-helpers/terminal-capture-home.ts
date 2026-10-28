// Preload for the real Node CLI, after the capture backend has assigned its private HOME.
import { assertRepoTempHome } from '../../support/home-sandbox.ts';

assertRepoTempHome(process.env.HOME, 'Physical capture HOME');
const {default: createListModel} = await import('../../utils/create-list-model.ts');
const {default: boards} = await import('../../scrumban/model.ts');
const document = Array.from({length: 44}, (_, index) => `Row${String(index + 1).padStart(2, '0')}`).join('\n');
const todos = createListModel({dbName: 'todos', collectionName: 'todos', itemKey: 'tasks', itemHasCheck: true});
todos.add({title: 'Capture Tasks', description: ''});
todos.tasks.add({title: 'Capture task', description: document, done: false});
const notes = createListModel({dbName: 'notes', collectionName: 'notes', itemKey: 'notes'});
const current = notes.add({title: 'Capture Notes', description: ''});
notes.notes.add({title: 'Capture note', content: document});
notes.add({title: 'Archive Notes', description: ''});
notes.notes.add({title: 'Archived note', content: 'Synthetic archived content'});
notes.use(current.$id);
boards.add({title: 'Capture Board', description: '', current: true, columns: [
  {id: 'backlog', title: 'Backlog'}, {id: 'ready', title: 'Ready'}
]});
boards.cards.add({title: `Long ${'x'.repeat(120)}`, description: document});
boards.cards.add({title: 'Other', description: ''}, {columnIndex: 2});
