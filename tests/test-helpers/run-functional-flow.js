#!/usr/bin/env node
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const flowName = process.argv[2];
const repoRoot = path.resolve(__dirname, '..', '..');

const promptAnswersByFlow = {
  todo: [
    {title: 'Inbox', description: 'Pendientes'},
    {title: 'Comprar pan', description: 'Integral'}
  ],
  note: [
    {title: 'Ideas', description: 'Notas base'},
    {title: 'Idea rápida', labels: []},
    'Texto funcional'
  ],
  board: [
    {title: 'Product', description: 'Delivery flow', columns: 'Ideas, Ready, Ship'},
    {defaultColumnId: 'ready'},
    {title: 'Write docs', description: 'v1'},
    {action: 'exit'}
  ],
  clock: [
    {search: 'mexico'},
    {timezone: 'America/Mexico_City'},
    {name: 'CDMX'},
    {search: 'madrid'},
    {timezone: 'Europe/Madrid'},
    {name: 'Madrid'},
    {indexes: [1]}
  ]
};

async function main() {
  if (!promptAnswersByFlow[flowName]) {
    throw new Error(`Unsupported flow: ${flowName}`);
  }

  const originalLoad = Module._load;
  const originalConsoleLog = console.log;
  const originalPathEnv = process.env.PATH;
  const promptAnswers = [...promptAnswersByFlow[flowName]];
  const output = [];

  Module._load = function patchedLoad(request, parent, isMain) {
      if (request === '../utils/inquirer') {
      return {
        prompt: async () => {
          if (promptAnswers.length === 0) {
            throw new Error(`No prompt answers left for ${flowName}`);
          }

          return promptAnswers.shift();
        }
      };
    }

    if (request === './inline-note-prompt' && flowName === 'note') {
      return async () => {
        if (promptAnswers.length === 0) {
          throw new Error(`No inline prompt answers left for ${flowName}`);
        }

        return promptAnswers.shift();
      };
    }

    return originalLoad.apply(this, arguments);
  };

  console.log = (...args) => {
    output.push(args.join(' '));
  };

  try {
    let localPaths = require(path.join(repoRoot, 'utils', 'local-paths.js'));
    let result;

    if (flowName === 'todo') {
      const Todos = require(path.join(repoRoot, 'todos'));
      const TodosModel = require(path.join(repoRoot, 'todos', 'model.js'));

      await Todos.Lists.actions([], {add: true});
      await Todos.Tasks.actions([], {add: true});

      result = {
        storageDir: localPaths.storageDirPath(),
        dbFile: localPaths.dbFilePath('todos'),
        dbFileExists: fs.existsSync(localPaths.dbFilePath('todos')),
        currentList: TodosModel.getCurrent(),
        output: output.join('\n')
      };
    }

    if (flowName === 'note') {
      process.env.PATH = '';
      const Notes = require(path.join(repoRoot, 'notes'));
      const NotesModel = require(path.join(repoRoot, 'notes', 'model.js'));

      await Notes.Lists.actions([], {add: true});
      await Notes.Notes.actions([], {add: true});

      result = {
        storageDir: localPaths.storageDirPath(),
        dbFile: localPaths.dbFilePath('notes'),
        dbFileExists: fs.existsSync(localPaths.dbFilePath('notes')),
        currentList: NotesModel.getCurrent(),
        output: output.join('\n')
      };
    }

    if (flowName === 'clock') {
      const Clocks = require(path.join(repoRoot, 'clocks'));
      const ClocksModel = require(path.join(repoRoot, 'clocks', 'model.js'));

      await Clocks.actions([], {add: true});
      await Clocks.actions([], {add: true});
      await Clocks.actions([], {show: true});
      await Clocks.actions([], {remove: 2});
      const afterRemoveOne = ClocksModel.find();
      await Clocks.actions([], {remove: true});

      result = {
        storageDir: localPaths.storageDirPath(),
        dbFile: localPaths.dbFilePath('clocks'),
        dbFileExists: fs.existsSync(localPaths.dbFilePath('clocks')),
        savedClocksBeforeRemoveAll: afterRemoveOne,
        savedClocksAfterRemoveAll: ClocksModel.find(),
        removeSelection: [1],
        output: output.join('\n')
      };
    }

    if (flowName === 'board') {
      const Scrumban = require(path.join(repoRoot, 'scrumban'));
      const ScrumbanModel = require(path.join(repoRoot, 'scrumban', 'model.js'));

      await Scrumban.Board.actions([], {addBoard: true});
      await Scrumban.Board.actions([], {add: true});

      result = {
        storageDir: localPaths.storageDirPath(),
        dbFile: localPaths.dbFilePath('boards'),
        dbFileExists: fs.existsSync(localPaths.dbFilePath('boards')),
        currentBoard: ScrumbanModel.getCurrent(),
        output: output.join('\n')
      };
    }

    process.stdout.write(JSON.stringify(result));
  } finally {
    process.env.PATH = originalPathEnv;
    console.log = originalConsoleLog;
    Module._load = originalLoad;
  }
}

main().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
