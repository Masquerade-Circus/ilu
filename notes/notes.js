let inquirer = require('inquirer');
let {required, log, getLabel} = require('../utils');
let Model = require('./model');
let isUndefined = require('lodash/isUndefined');
let find = require('lodash/find');
let os = require('os');
let opn = require('opn');
let shelljs = require('shelljs');
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

let editor = null;
for (let cmd of editors) {
    if (shelljs.which(cmd)) {
        editor = cmd;
        break;
    }
}

let Notes = {
    dir: `${os.homedir()}/.ilu/`,
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
            let file = `${Notes.dir}note.txt`;
            shelljs.touch(file);
            shelljs.chmod(755, file);
            await opn(file, {wait: true, app: editor});
            answers.content = shelljs.cat(file).stdout;
            shelljs.rm(file);
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
            let file = `${Notes.dir}note.txt`;
            shelljs.touch(file);
            shelljs.chmod(755, file);
            shelljs.ShellString(item.content).to(file);
            await opn(file, {wait: true, app: editor});
            answers.content = shelljs.cat(file).stdout;
            shelljs.rm(file);
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
