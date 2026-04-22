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
    Clocks: { actions: action },
    Tts: { action, voiceAction: action }
  });

  assert.deepEqual(
    commands.map(command => command.name),
    ['todo', 'note', 'board', 'sync', 'sync init', 'sync status', 'sync retry', 'sync enable', 'sync disable', 'babel', 'clock', 'tts', 'tts voice']
  );
  assert.equal(commands[0].alias, 't');
  assert.equal(commands[1].alias, 'n');
  assert.equal(commands[2].alias, 'bd');
  assert.equal(commands[9].alias, 'b');
  assert.equal(commands[10].alias, 'c');
  assert.equal(commands[11].alias, undefined);
  assert.equal(commands[9].arguments[0].signature, '<text...>');
  assert.equal(commands[11].arguments[0].signature, '<inputFile>');
  assert.equal(commands[11].arguments[1].signature, '<outputFile>');
});

test('configureProgram parsea tts con archivos sin requerir voice', async () => {
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
    Clocks: {actions: async () => {}},
    Tts: {action, voiceAction: async () => {}}
  });

  await program.parseAsync(['node', 'ilu', 'tts', 'chapter.md', 'chapter.mp3']);

  assert.deepEqual(calls, [{
    args: {inputFile: 'chapter.md', outputFile: 'chapter.mp3'},
    opts: {}
  }]);
});

test('configureProgram parsea tts voice sin argumento posicional', async () => {
  delete require.cache[require.resolve(configureCliModulePath)];

  const configureProgram = require(configureCliModulePath);
  const calls = [];

  const program = new Command();
  program.exitOverride();

  configureProgram(program, {
    pkg: {version: '0.0.0'},
    Todos: {Tasks: {actions: async () => {}}, Lists: {actions: async () => {}}},
    Notes: {Notes: {actions: async () => {}}, Lists: {actions: async () => {}}},
    Translate: {osLang: 'es', validate: value => value.join(' '), action: async () => {}},
    Clocks: {actions: async () => {}},
    Tts: {
      action: async () => {},
      voiceAction: async (args, opts) => calls.push({args, opts})
    }
  });

  await program.parseAsync(['node', 'ilu', 'tts', 'voice']);

  assert.deepEqual(calls, [{
    args: {},
    opts: {}
  }]);
});

test('configureProgram rechaza argumento posicional extra en tts voice', async () => {
  delete require.cache[require.resolve(configureCliModulePath)];

  const configureProgram = require(configureCliModulePath);
  const program = new Command();
  program.exitOverride();

  configureProgram(program, {
    pkg: {version: '0.0.0'},
    Todos: {Tasks: {actions: async () => {}}, Lists: {actions: async () => {}}},
    Notes: {Notes: {actions: async () => {}}, Lists: {actions: async () => {}}},
    Translate: {osLang: 'es', validate: value => value.join(' '), action: async () => {}},
    Clocks: {actions: async () => {}},
    Tts: {action: async () => {}, voiceAction: async () => {}}
  });

  await assert.rejects(
    program.parseAsync(['node', 'ilu', 'tts', 'voice', 'fable']),
    error => error && /too many arguments/i.test(error.message)
  );
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

test('configureProgram normaliza aliases raros de board management y preserva priority', async () => {
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
  await program.parseAsync(['node', 'ilu', 'board', '-ab']);
  await program.parseAsync(['node', 'ilu', 'board', '-eb']);
  await program.parseAsync(['node', 'ilu', 'board', '-rb']);

  assert.deepEqual(boardCalls, [
    {args: [], opts: {priority: true}},
    {args: [], opts: {addBoard: true}},
    {args: [], opts: {editBoard: true}},
    {args: [], opts: {removeBoard: true}}
  ]);
});
