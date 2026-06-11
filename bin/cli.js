#!/usr/bin/env node
let path = require('node:path');
let {Command} = require('commander');
let pkg = require('../package.json');
// TODO use https://github.com/sindresorhus/terminal-link to parse content and convert links

let Translate = require('../translate');
let configureProgram = require('./configure-cli');

function lazyAction(load, select) {
    return async (...args) => select(load())(...args);
}

function loadUiApp() {
    process.env.TSX_TSCONFIG_PATH = path.join(__dirname, '..', 'tsconfig.ui.json');
    require('tsx/cjs');

    return require('../ui/app.tsx');
}

let Todos = {
    Tasks: {
        actions: lazyAction(() => require('../todos'), (module) => module.Tasks.actions)
    },
    Lists: {
        actions: lazyAction(() => require('../todos'), (module) => module.Lists.actions)
    }
};

let Notes = {
    Notes: {
        actions: lazyAction(() => require('../notes'), (module) => module.Notes.actions)
    },
    Lists: {
        actions: lazyAction(() => require('../notes'), (module) => module.Lists.actions)
    }
};

let Scrumban = {
    Board: {
        actions: lazyAction(() => require('../scrumban'), (module) => module.Board.actions)
    },
    BoardLists: {
        actions: lazyAction(() => require('../scrumban'), (module) => module.BoardLists.actions)
    }
};

let Sync = {
    init: lazyAction(() => require('../sync/commands'), (module) => module.init),
    status: lazyAction(() => require('../sync/commands'), (module) => module.status),
    retry: lazyAction(() => require('../sync/commands'), (module) => module.retry),
    enable: lazyAction(() => require('../sync/commands'), (module) => module.enable),
    disable: lazyAction(() => require('../sync/commands'), (module) => module.disable)
};

let Clocks = {
    actions: lazyAction(() => require('../clocks'), (module) => module.actions)
};

let Tts = {
    action: lazyAction(() => require('../tts'), (module) => module.action),
    voiceAction: lazyAction(() => require('../tts'), (module) => module.voiceAction)
};

let Ui = {
    action: lazyAction(loadUiApp, (module) => module.action)
};

let program = new Command();

configureProgram(program, {
    pkg,
    Todos,
    Notes,
    Scrumban,
    Sync,
    Translate,
    Clocks,
    Tts,
    Ui
});

program.parse(process.argv);
