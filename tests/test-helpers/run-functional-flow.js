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
    {title: 'Idea rápida', content: 'Texto funcional'}
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

    if (request === './open-with-editor' && flowName === 'note') {
      return async () => {};
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
