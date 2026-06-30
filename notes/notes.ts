import prompts from '../utils/prompts.ts';
import * as __cjsImport17 from '../utils/index.ts';
const { required, log, getLabel } = __cjsImport17;
import Model from './model.ts';
import isUndefined from 'lodash/isUndefined.js';
import find from 'lodash/find.js';
import localPaths from '../utils/local-paths.ts';
import * as __cjsImport18 from '../utils/prompt-index-selection.ts';
const { selectOne, selectMany } = __cjsImport18;
import promptInlineNote from './inline-note-prompt.ts';
function getNoteChoice(item: any, index: any) {
    let labels = '';
    item.labels.forEach((label: any) => {
        labels += ` ${getLabel(label.color, label.title)}`;
    });

    return `${index + 1} ${item.title}${labels}`;
}

let Notes = {
    dir: `${localPaths.storageDirPath()}/`,
    getCurrent() {
        let list = Model.getCurrent();
        if (!list) {
            log.info(`You dont have any lists, try adding one.`.blue, 'blue');
            process.exit(1);
            return;
        }

        return list;
    },
    get(index: any) {
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
        let questions: any[] = [
            { type: 'input', name: 'title', message: 'Title of the note', suffix: ' (required)', validate: required('title')}
        ];

        if (list.labels.length > 0) {
            let choices = list.labels.map((label: any) => {
                return {
                    name: getLabel(label.color, label.title),
                    value: label
                };
            });
            questions.push({type: 'checkbox', name: 'labels', message: 'Add labels to the note.', choices: choices });
        }

        let answers = await prompts.prompt(questions);
        let content = await promptInlineNote({message: 'Content of the note', initialValue: ''});

        if (content === null) {
            return;
        }

        answers.content = content;

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

        list.notes.forEach((item: any, index: any) => {
            let str = `${index + 1} ${item.title}`;
            let labels = '';
            item.labels.forEach((label: any) => {
                labels += ' ' + getLabel(label.color, label.title);
            });
            log.pointerSmall(str + labels);
        });
    },
    async selectIndex(message: any) {
        let list = Notes.getCurrent();

        return selectOne(list.notes, {
            message,
            emptyMessage: 'You dont have any notes, try adding one.',
            getChoiceName: getNoteChoice
        });
    },
    async selectIndexes(message: any) {
        let list = Notes.getCurrent();

        return selectMany(list.notes, {
            message,
            emptyMessage: 'You dont have any notes, try adding one.',
            getChoiceName: getNoteChoice
        });
    },
    async remove() {
        let indexes = await Notes.selectIndexes('Select notes to remove.');

        [...indexes]
            .sort((left: any, right: any) => right - left)
            .forEach((position: any) => {
                Notes.get(position);
                Model.notes.remove(position);
            });
        log.info(`${indexes.length} ${indexes.length === 1 ? 'note has' : 'notes have'} been removed.`.blue, 'blue');

        Notes.show();
    },
    async details() {
        let selectedIndex = await Notes.selectIndex('Select a note.');
        let item = Notes.get(selectedIndex);
        log('Title'.gray);
        log(item.title.cyan, 4);
        if (item.content.trim().length > 0) {
            log('Content'.gray);
            log(item.content, 4);
        }
        if (item.labels.length > 0) {
            log('Labels'.gray);
            let labels = '';
            item.labels.forEach((label: any) => {
                labels += getLabel(label.color, label.title) + ' ';
            });
            log(labels, 4);
        }
    },
    async edit() {
        let selectedIndex = await Notes.selectIndex('Select a note.');
        let item = Notes.get(selectedIndex);
        let list = Notes.getCurrent();

        let questions: any[] = [
            { type: 'input', name: 'title', message: 'Title of the note', suffix: ' (required)', validate: required('title'), default: item.title}
        ];

        if (list.labels.length > 0) {
            let choices = list.labels.map((label: any) => {

                return {
                    name: getLabel(label.color, label.title),
                    value: label,
                    checked: !isUndefined(find(item.labels, label))
                };
            });
            questions.push({type: 'checkbox', name: 'labels', message: 'Add labels to the note.', choices: choices });
        }

        let answers = await prompts.prompt(questions);
        let content = await promptInlineNote({message: 'Content of the note', initialValue: item.content});

        if (content === null) {
            return;
        }

        answers.content = content;

        Model.notes.edit(selectedIndex, answers);
        Notes.show();
    },
    async actions(args: any, opts: any) {
        switch (true) {
            case !isUndefined(opts.add): await Notes.add(); break;
            case !isUndefined(opts.details): await Notes.details(); break;
            case !isUndefined(opts.show): Notes.show(); break;
            case !isUndefined(opts.remove): await Notes.remove(); break;
            case !isUndefined(opts.edit): await Notes.edit(); break;
            default: Notes.show(); break;
        }
    }
};

export const dir = Notes.dir;
export const getCurrent = Notes.getCurrent;
export const get = Notes.get;
export const add = Notes.add;
export const show = Notes.show;
export const details = Notes.details;
export const remove = Notes.remove;
export const edit = Notes.edit;
export const actions = Notes.actions;
export default Notes;
