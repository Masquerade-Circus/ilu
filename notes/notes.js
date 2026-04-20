let inquirer = require('../utils/inquirer');
let fs = require('node:fs');
let path = require('node:path');
let {required, log, getLabel} = require('../utils');
let Model = require('./model');
let isUndefined = require('lodash/isUndefined');
let find = require('lodash/find');
let openWithEditor = require('./open-with-editor');
let localPaths = require('../utils/local-paths');
let editors = [
    'notepad',
    'gedit',
    'textedit',
    'code',
    'atom',
    'emacs',
    'sublime',
    'webstorm',
    'phpstorm',
    'visualstudio'
];
let darwinAppEditors = [
    'textedit',
    'code',
    'atom',
    'emacs',
    'sublime',
    'webstorm',
    'phpstorm',
    'visualstudio'
];

let editor = null;

function getPathEntries() {
    let pathEnv = process.env.PATH || '';
    return pathEnv.split(path.delimiter).filter(Boolean);
}

function getCommandCandidates(cmd) {
    if (process.platform !== 'win32') {
        return [cmd];
    }

    let pathExt = process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM';
    let extensions = pathExt.split(';').filter(Boolean);
    let normalizedCmd = cmd.toLowerCase();

    if (extensions.some(ext => normalizedCmd.endsWith(ext.toLowerCase()))) {
        return [cmd];
    }

    return [cmd, ...extensions.map(ext => `${cmd}${ext}`)];
}

function commandExists(cmd) {
    for (let dir of getPathEntries()) {
        for (let candidate of getCommandCandidates(cmd)) {
            let fullPath = path.join(dir, candidate);

            try {
                fs.accessSync(fullPath, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
                return true;
            } catch (error) {}
        }
    }

    return false;
}

function editorAvailable(cmd) {
    return commandExists(cmd) || (process.platform === 'darwin' && darwinAppEditors.includes(cmd));
}

function ensureTempFile(file) {
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.closeSync(fs.openSync(file, 'a'));
    if (process.platform !== 'win32') {
        fs.chmodSync(file, 0o600);
    }
}

function readTempFile(file) {
    return fs.readFileSync(file, 'utf8');
}

function writeTempFile(file, content) {
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, content, 'utf8');
}

function removeTempFile(file) {
    fs.rmSync(file, {force: true});
}

for (let cmd of editors) {
    if (editorAvailable(cmd)) {
        editor = cmd;
        break;
    }
}

let Notes = {
    dir: `${localPaths.storageDirPath()}/`,
    getTempFilePath() {
        return localPaths.noteTempFilePath();
    },
    getCurrent() {
        let list = Model.getCurrent();
        if (!list) {
            log.info(`You dont have any lists, try adding one.`.blue, 'blue');
            process.exit(1);
            return;
        }

        return list;
    },
    get(index) {
        let list = Notes.getCurrent();
        let item = list.notes[index - 1];
        if (!item) {
            log.cross(`The note "${index}" does not exists`.red, 'red');
            process.exit(1);
            return;
        }

        return item;
    },
    async add() {
        let list = Notes.getCurrent();
        let questions = [
            { type: 'input', name: 'title', message: 'Title of the note', suffix: ' (required)', validate: required('title')}
        ];

        if (list.labels.length > 0) {
            let choices = list.labels.map(label => {
                return {
                    name: getLabel(label.color, label.title),
                    value: label
                };
            });
            questions.push({type: 'checkbox', name: 'labels', message: 'Add labels to the note.', choices: choices });
        }

        if (!editor) {
            questions.push({ type: 'input', name: 'content', message: 'Content of the note'});
        }

        let answers = await inquirer.prompt(questions);

        if (editor) {
            let file = Notes.getTempFilePath();
            ensureTempFile(file);
            await openWithEditor(file, {app: editor});
            answers.content = readTempFile(file);
            removeTempFile(file);
        }

        Model.notes.add(answers);
        Notes.show();
    },
    show() {
        let list = Notes.getCurrent();
        if (list.notes.length === 0) {
            log.info(`You dont have any notes, try adding one.`.blue, 'blue');
            process.exit(1);
            return;
        }

        list.notes.forEach((item, index) => {
            let str = `${index + 1} ${item.title}`;
            let labels = '';
            item.labels.forEach(label => {
                labels += ' ' + getLabel(label.color, label.title);
            });
            log.pointerSmall(str + labels);
        });
    },
    remove(index) {
        if (typeof index === 'number') {
            Notes.get(index);
            Model.notes.remove(index);
            log.info(`The note "${index}" has been removed.`.blue, 'blue');
        } else {
            Model.notes.remove();
            log.info(`All the notes have been removed.`.blue, 'blue');
        }
        Notes.show();
    },
    details(index) {
        let item = Notes.get(index);
        log('Title'.gray);
        log(item.title.cyan, 4);
        if (item.content.trim().length > 0) {
            log('Content'.gray);
            log(item.content, 4);
        }
        if (item.labels.length > 0) {
            log('Labels'.gray);
            let labels = '';
            item.labels.forEach((label) => {
                labels += getLabel(label.color, label.title) + ' ';
            });
            log(labels, 4);
        }
    },
    async edit(index) {
        let item = Notes.get(index);
        let list = Notes.getCurrent();

        let questions = [
            { type: 'input', name: 'title', message: 'Title of the note', suffix: ' (required)', validate: required('title'), default: item.title}
        ];

        if (list.labels.length > 0) {
            let choices = list.labels.map(label => {

                return {
                    name: getLabel(label.color, label.title),
                    value: label,
                    checked: !isUndefined(find(item.labels, label))
                };
            });
            questions.push({type: 'checkbox', name: 'labels', message: 'Add labels to the note.', choices: choices });
        }

        if (!editor) {
            questions.push({ type: 'input', name: 'content', message: 'Content of the note', default: item.content});
        }

        let answers = await inquirer.prompt(questions);

        if (editor) {
            let file = Notes.getTempFilePath();
            ensureTempFile(file);
            writeTempFile(file, item.content);
            await openWithEditor(file, {app: editor});
            answers.content = readTempFile(file);
            removeTempFile(file);
        }

        Model.notes.edit(index, answers);
        Notes.show();
    },
    async actions(args, opts) {
        switch (true) {
            case !isUndefined(opts.add): await Notes.add(); break;
            case !isUndefined(opts.details): Notes.details(opts.details); break;
            case !isUndefined(opts.show): Notes.show(); break;
            case !isUndefined(opts.remove): Notes.remove(opts.remove); break;
            case !isUndefined(opts.edit): await Notes.edit(opts.edit); break;
            default: Notes.show(); break;
        }
    }
};

module.exports = Notes;
