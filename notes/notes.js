let inquirer = require('inquirer');
let {required, log, getLabel} = require('../utils');
let Model = require('./model');
let isUndefined = require('lodash/isUndefined');
let find = require('lodash/find');

let Notes = {
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
            { type: 'input', name: 'title', message: 'Title of the note', suffix: ' (required)', validate: required('title')},
            { type: 'input', name: 'content', message: 'Content of the note'}
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

        let answers = await inquirer.prompt(questions);
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
            { type: 'input', name: 'title', message: 'Title of the note', suffix: ' (required)', validate: required('title'), default: item.title},
            { type: 'input', name: 'content', message: 'Content of the note', default: item.content}
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

        let answers = await inquirer.prompt(questions);
        Model.notes.edit(index, answers);
        Notes.show();
    },
    async actions(args, opts) {
        try {
            switch (true) {
                case !isUndefined(opts.add): await Notes.add(); break;
                case !isUndefined(opts.details): Notes.details(opts.details); break;
                case !isUndefined(opts.show): Notes.show(); break;
                case !isUndefined(opts.remove): Notes.remove(opts.remove); break;
                case !isUndefined(opts.check): await Notes.check(); break;
                case !isUndefined(opts.edit): await Notes.edit(opts.edit); break;
                default: Notes.show(); break;
            }
        } catch (error) {
            console.log(error);
        }

    }
};

module.exports = Notes;
