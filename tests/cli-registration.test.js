const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {Command} = require('commander');

const repoRoot = path.resolve(__dirname, '..');
const configureCliModulePath = path.join(repoRoot, 'bin', 'configure-cli.js');

function createFakeProgram() {
  const commands = [];

  function createCommandApi(entry, parentReturn) {
    return {
      alias(value) {
        entry.alias = value;
        return this;
      },
      help(value) {
        entry.help = value;
        return this;
      },
      description(value) {
        entry.description = value;
        return this;
      },
      option(flags, description, parser, defaultValue) {
        entry.options.push({ flags, description, parser, defaultValue });
        return this;
      },
      requiredOption(flags, description, parser, defaultValue) {
        entry.options.push({ flags, description, parser, defaultValue, required: true });
        return this;
      },
      addOption(option) {
        entry.options.push({
          flags: option.flags,
          description: option.description,
          defaultValue: option.defaultValue
        });
        return this;
      },
      argument(signature, description, validator) {
        entry.arguments.push({ signature, description, validator });
        return this;
      },
      command(name) {
        const nestedEntry = {
          name: `${entry.name} ${name}`,
          alias: undefined,
          help: undefined,
          description: undefined,
          options: [],
          arguments: [],
          action: undefined
        };
        commands.push(nestedEntry);
        return createCommandApi(nestedEntry, this);
      },
      action(handler) {
        entry.action = handler;
        return parentReturn;
      }
    };
  }

  const program = {
    INT: Symbol('INT'),
    name() {
      return this;
    },
    version() {
      return this;
    },
    description() {
      return this;
    },
    command(name) {
      const entry = {
        name,
        alias: undefined,
        help: undefined,
        description: undefined,
        options: [],
        arguments: [],
        action: undefined
      };

      commands.push(entry);

      return createCommandApi(entry, program);
    },
    parse() {
      return this;
    }
  };

  return { program, commands };
}

test('configureProgram registra los comandos principales del CLI', () => {
  delete require.cache[require.resolve(configureCliModulePath)];

  const configureProgram = require(configureCliModulePath);
  const { program, commands } = createFakeProgram();
  const action = () => {};
  const translateValidate = () => true;

  configureProgram(program, {
    pkg: { version: '0.0.0' },
    updateNotifier: () => ({ notify() {} }),
    Todos: { Tasks: { actions: action }, Lists: { actions: action } },
    Notes: { Notes: { actions: action }, Lists: { actions: action } },
    Scrumban: { Board: { actions: action }, BoardLists: { actions: action } },
    Translate: { osLang: 'es', validate: translateValidate, action },
    Clocks: { actions: action }
  });

  assert.deepEqual(
    commands.map(command => command.name),
    ['todo', 'note', 'board', 'sync', 'sync init', 'sync status', 'sync retry', 'sync enable', 'sync disable', 'babel', 'clock']
  );
  assert.equal(commands[0].alias, 't');
  assert.equal(commands[1].alias, 'n');
  assert.equal(commands[2].alias, 'bd');
  assert.equal(commands[9].alias, 'b');
  assert.equal(commands[10].alias, 'c');
  assert.equal(commands[9].arguments[0].signature, '<text...>');
});

test('configureProgram preserva argumentos y defaults de babel al parsear con commander', async () => {
  delete require.cache[require.resolve(configureCliModulePath)];

  const configureProgram = require(configureCliModulePath);
  const calls = [];
  const action = async (args, opts) => {
    calls.push({args, opts});
  };

  const program = new Command();
  program.exitOverride();

  configureProgram(program, {
    pkg: {version: '0.0.0'},
    Todos: {Tasks: {actions: async () => {}}, Lists: {actions: async () => {}}},
    Notes: {Notes: {actions: async () => {}}, Lists: {actions: async () => {}}},
    Translate: {osLang: 'es', validate: value => value.join(' '), action},
    Clocks: {actions: async () => {}}
  });

  await program.parseAsync(['node', 'ilu', 'b', 'hola', 'mundo']);

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    args: {text: 'hola mundo'},
    opts: {source: 'auto', target: 'es'}
  });
});

test('configureProgram parsea opciones de listas de todo desde el comando todo', async () => {
  delete require.cache[require.resolve(configureCliModulePath)];

  const configureProgram = require(configureCliModulePath);
  const taskCalls = [];
  const listCalls = [];

  const program = new Command();
  program.exitOverride();

  configureProgram(program, {
    pkg: {version: '0.0.0'},
    Todos: {
      Tasks: {actions: async (args, opts) => taskCalls.push({args, opts})},
      Lists: {actions: async (args, opts) => listCalls.push({args, opts})}
    },
    Notes: {Notes: {actions: async () => {}}, Lists: {actions: async () => {}}},
    Translate: {osLang: 'es', validate: value => value.join(' '), action: async () => {}},
    Clocks: {actions: async () => {}}
  });

  await program.parseAsync(['node', 'ilu', 'todo', '--lists']);
  await program.parseAsync(['node', 'ilu', 'todo', '--use-list']);
  await program.parseAsync(['node', 'ilu', 'todo', '--add-list']);
  await program.parseAsync(['node', 'ilu', 'todo', '--edit-list']);
  await program.parseAsync(['node', 'ilu', 'todo', '--remove-list']);

  assert.deepEqual(taskCalls, []);
  assert.deepEqual(listCalls, [
    {args: [], opts: {show: true}},
    {args: [], opts: {use: true}},
    {args: [], opts: {add: true}},
    {args: [], opts: {edit: true}},
    {args: [], opts: {remove: true}}
  ]);
});

test('configureProgram registra y parsea clock con alias y remove opcional', async () => {
  delete require.cache[require.resolve(configureCliModulePath)];

  const configureProgram = require(configureCliModulePath);
  const calls = [];
  const action = async (args, opts) => {
    calls.push({args, opts});
  };

  const program = new Command();
  program.exitOverride();

  configureProgram(program, {
    pkg: {version: '0.0.0'},
    Todos: {Tasks: {actions: async () => {}}, Lists: {actions: async () => {}}},
    Notes: {Notes: {actions: async () => {}}, Lists: {actions: async () => {}}},
    Translate: {osLang: 'es', validate: value => value.join(' '), action: async () => {}},
    Clocks: {actions: action}
  });

  await program.parseAsync(['node', 'ilu', 'c', '--remove']);

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    args: [],
    opts: {remove: true}
  });
});

test('configureProgram parsea flags interactivas de todo sin valor explícito', async () => {
  delete require.cache[require.resolve(configureCliModulePath)];

  const configureProgram = require(configureCliModulePath);
  const calls = [];
  const action = async (args, opts) => {
    calls.push({args, opts});
  };

  const program = new Command();
  program.exitOverride();

  configureProgram(program, {
    pkg: {version: '0.0.0'},
    Todos: {Tasks: {actions: action}, Lists: {actions: async () => {}}},
    Notes: {Notes: {actions: async () => {}}, Lists: {actions: async () => {}}},
    Translate: {osLang: 'es', validate: value => value.join(' '), action: async () => {}},
    Clocks: {actions: async () => {}}
  });

  await program.parseAsync(['node', 'ilu', 't', '--details']);
  await program.parseAsync(['node', 'ilu', 't', '--edit']);
  await program.parseAsync(['node', 'ilu', 't', '--remove']);

  assert.deepEqual(calls, [
    {args: [], opts: {details: true}},
    {args: [], opts: {edit: true}},
    {args: [], opts: {remove: true}}
  ]);
});

test('configureProgram parsea flags opcionales de note sin valor explícito para details, edit y remove', async () => {
  delete require.cache[require.resolve(configureCliModulePath)];

  const configureProgram = require(configureCliModulePath);
  const calls = [];
  const action = async (args, opts) => {
    calls.push({args, opts});
  };

  const program = new Command();
  program.exitOverride();

  configureProgram(program, {
    pkg: {version: '0.0.0'},
    Todos: {Tasks: {actions: async () => {}}, Lists: {actions: async () => {}}},
    Notes: {Notes: {actions: action}, Lists: {actions: async () => {}}},
    Translate: {osLang: 'es', validate: value => value.join(' '), action: async () => {}},
    Clocks: {actions: async () => {}}
  });

  await program.parseAsync(['node', 'ilu', 'n', '--details']);
  await program.parseAsync(['node', 'ilu', 'n', '--edit']);
  await program.parseAsync(['node', 'ilu', 'n', '--remove']);

  assert.deepEqual(calls, [
    {args: [], opts: {details: true}},
    {args: [], opts: {edit: true}},
    {args: [], opts: {remove: true}}
  ]);
});

test('configureProgram parsea gestión de listas de note desde el comando note', async () => {
  delete require.cache[require.resolve(configureCliModulePath)];

  const configureProgram = require(configureCliModulePath);
  const noteCalls = [];
  const noteListCalls = [];

  const program = new Command();
  program.exitOverride();

  configureProgram(program, {
    pkg: {version: '0.0.0'},
    Todos: {
      Tasks: {actions: async () => {}},
      Lists: {actions: async () => {}}
    },
    Notes: {
      Notes: {actions: async (args, opts) => noteCalls.push({args, opts})},
      Lists: {actions: async (args, opts) => noteListCalls.push({args, opts})}
    },
    Translate: {osLang: 'es', validate: value => value.join(' '), action: async () => {}},
    Clocks: {actions: async () => {}}
  });

  await program.parseAsync(['node', 'ilu', 'note', '--show']);
  await program.parseAsync(['node', 'ilu', 'note', '--lists']);
  await program.parseAsync(['node', 'ilu', 'note', '--use-list']);
  await program.parseAsync(['node', 'ilu', 'note', '--add-list']);
  await program.parseAsync(['node', 'ilu', 'note', '--edit-list']);
  await program.parseAsync(['node', 'ilu', 'note', '--remove-list']);

  assert.deepEqual(noteCalls, [
    {args: [], opts: {show: true}}
  ]);

  assert.deepEqual(noteListCalls, [
    {args: [], opts: {show: true}},
    {args: [], opts: {use: true}},
    {args: [], opts: {add: true}},
    {args: [], opts: {edit: true}},
    {args: [], opts: {remove: true}}
  ]);
});

test('configureProgram registra board con default show cuando no recibe flags', async () => {
  delete require.cache[require.resolve(configureCliModulePath)];

  const configureProgram = require(configureCliModulePath);
  const boardCalls = [];

  const program = new Command();
  program.exitOverride();

  configureProgram(program, {
    pkg: {version: '0.0.0'},
    Todos: {Tasks: {actions: async () => {}}, Lists: {actions: async () => {}}},
    Notes: {Notes: {actions: async () => {}}, Lists: {actions: async () => {}}},
    Scrumban: {
      Board: {actions: async (args, opts) => boardCalls.push({args, opts})},
      BoardLists: {actions: async () => {}}
    },
    Translate: {osLang: 'es', validate: value => value.join(' '), action: async () => {}},
    Clocks: {actions: async () => {}}
  });

  await program.parseAsync(['node', 'ilu', 'bd']);

  assert.deepEqual(boardCalls, [{args: [], opts: {}}]);
});

test('configureProgram parsea board --priority, --list-boards, --use-board, --add-board y short flags de board management', async () => {
  delete require.cache[require.resolve(configureCliModulePath)];

  const configureProgram = require(configureCliModulePath);
  const boardCalls = [];

  const program = new Command();
  program.exitOverride();

  configureProgram(program, {
    pkg: {version: '0.0.0'},
    Todos: {Tasks: {actions: async () => {}}, Lists: {actions: async () => {}}},
    Notes: {Notes: {actions: async () => {}}, Lists: {actions: async () => {}}},
    Scrumban: {
      Board: {actions: async (args, opts) => boardCalls.push({args, opts})},
      BoardLists: {actions: async () => {}}
    },
    Translate: {osLang: 'es', validate: value => value.join(' '), action: async () => {}},
    Clocks: {actions: async () => {}}
  });

  await program.parseAsync(['node', 'ilu', 'board', '--priority']);
  await program.parseAsync(['node', 'ilu', 'board', '--list-boards']);
  await program.parseAsync(['node', 'ilu', 'board', '--use-board']);
  await program.parseAsync(['node', 'ilu', 'board', '-l']);
  await program.parseAsync(['node', 'ilu', 'board', '-u']);
  await program.parseAsync(['node', 'ilu', 'board', '--add-board']);
  await program.parseAsync(['node', 'ilu', 'board', '-ab']);
  await program.parseAsync(['node', 'ilu', 'board', '-eb']);
  await program.parseAsync(['node', 'ilu', 'board', '-rb']);

  assert.deepEqual(boardCalls, [
    {args: [], opts: {priority: true}},
    {args: [], opts: {listBoards: true}},
    {args: [], opts: {useBoard: true}},
    {args: [], opts: {listBoards: true}},
    {args: [], opts: {useBoard: true}},
    {args: [], opts: {addBoard: true}},
    {args: [], opts: {addBoard: true}},
    {args: [], opts: {editBoard: true}},
    {args: [], opts: {removeBoard: true}}
  ]);
});
