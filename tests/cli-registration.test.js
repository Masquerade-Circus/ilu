const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {Command} = require('commander');

const repoRoot = path.resolve(__dirname, '..');
const configureCliModulePath = path.join(repoRoot, 'bin', 'configure-cli.js');

function createFakeProgram() {
  const commands = [];

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
        action(handler) {
          entry.action = handler;
          return program;
        }
      };
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
    Translate: { osLang: 'es', validate: translateValidate, action },
    Clocks: { actions: action }
  });

  assert.deepEqual(
    commands.map(command => command.name),
    ['todo', 'todo-list', 'note', 'note-list', 'babel', 'clock']
  );
  assert.equal(commands[0].alias, 't');
  assert.equal(commands[1].alias, 'tl');
  assert.equal(commands[2].alias, 'n');
  assert.equal(commands[3].alias, 'nl');
  assert.equal(commands[4].alias, 'b');
  assert.equal(commands[5].alias, 'c');
  assert.equal(commands[4].arguments[0].signature, '<text...>');
});

test('configureProgram no requiere update-notifier para registrar comandos', () => {
  delete require.cache[require.resolve(configureCliModulePath)];

  const configureProgram = require(configureCliModulePath);
  const { program, commands } = createFakeProgram();
  const action = () => {};

  assert.doesNotThrow(() => {
    configureProgram(program, {
      pkg: { version: '0.0.0' },
      Todos: { Tasks: { actions: action }, Lists: { actions: action } },
      Notes: { Notes: { actions: action }, Lists: { actions: action } },
      Translate: { osLang: 'es', validate: () => true, action },
      Clocks: { actions: action }
    });
  });

  assert.deepEqual(
    commands.map(command => command.name),
    ['todo', 'todo-list', 'note', 'note-list', 'babel', 'clock']
  );
});

test('configureProgram deja los comandos principales parseables con commander y adapta opts para los handlers', async () => {
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
    Todos: {Tasks: {actions: action}, Lists: {actions: action}},
    Notes: {Notes: {actions: action}, Lists: {actions: action}},
    Translate: {osLang: 'es', validate: value => value.join(' '), action},
    Clocks: {actions: action}
  });

  await program.parseAsync(['node', 'ilu', 't', '--remove', '2']);

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    args: [],
    opts: {remove: 2}
  });
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

test('configureProgram preserva opciones opcionales sin valor explícito para remove', async () => {
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
    Todos: {Tasks: {actions: async () => {}}, Lists: {actions: action}},
    Notes: {Notes: {actions: async () => {}}, Lists: {actions: async () => {}}},
    Translate: {osLang: 'es', validate: value => value.join(' '), action: async () => {}},
    Clocks: {actions: async () => {}}
  });

  await program.parseAsync(['node', 'ilu', 'tl', '--remove']);

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    args: [],
    opts: {remove: true}
  });
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
