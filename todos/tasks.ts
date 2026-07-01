import prompts from '../utils/prompts.ts';
import * as __cjsImport115 from '../utils/index.ts';
const { required, log, getLabel } = __cjsImport115;
import Model from './model.ts';
import isUndefined from 'lodash/isUndefined.js';
import find from 'lodash/find.js';
import * as __cjsImport116 from '../utils/prompt-index-selection.ts';
const { selectOne, selectMany } = __cjsImport116;

type TodoList = ReturnType<typeof Model.getCurrent>;
type TodoTask = TodoList['tasks'][number];
type TodoLabel = TodoList['labels'][number];
type PromptQuestions = Parameters<typeof prompts.prompt>[0];
type CommandOptions = Record<string, unknown>;

function getTaskChoice(item: TodoTask, index: number) {
    let labels = '';
    (item.labels as TodoLabel[]).forEach((label) => {
        labels += ` ${getLabel(label.color, label.title)}`;
    });

    return `${index + 1} ${item.title}${labels}`;
}

let Tasks = {
    getCurrent() {
        let list = Model.getCurrent();
        if (!list) {
            log.info(`You dont have any lists, try adding one.`.blue, 'blue');
            process.exit(1);
        }

        return list;
    },
    get(index: number) {
        let list = Tasks.getCurrent();
        let item = list.tasks[index - 1];
        if (!item) {
            log.cross(`The task "${index}" does not exists`.red, 'red');
            process.exit(1);
        }

        return item;
    },
    async add() {
        let list = Tasks.getCurrent();

        let questions: PromptQuestions = [
            { type: 'input', name: 'title', message: 'Title of the task', suffix: ' (required)', validate: required('title')},
            { type: 'input', name: 'description', message: 'Description of the task'}
        ];

        if (list.labels.length > 0) {
            let choices = list.labels.map((label: TodoLabel) => {
                return {
                    name: getLabel(label.color, label.title),
                    value: label
                };
            });
            questions.push({type: 'checkbox', name: 'labels', message: 'Add labels to the task.', choices: choices });
        }

        let answers = await prompts.prompt(questions);
        Model.tasks.add(answers);
        Tasks.show();
    },
    show() {
        let list = Tasks.getCurrent();
        if (list.tasks.length === 0) {
            log.info(`You dont have any tasks, try adding one.`.blue, 'blue');
            process.exit(1);
        }

        list.tasks.forEach((item: TodoTask, index: number) => {
            let str = `${index + 1} ${item.title}`;
            let labels = '';
            (item.labels as TodoLabel[]).forEach((label) => {
                labels += ' ' + getLabel(label.color, label.title);
            });
            if (item.done) {
                log.radioOn(str.green + labels, 'green');
                return;
            }
            log.radioOff(str + labels);
        });
    },
    async check() {
        let list = Tasks.getCurrent();
        if (list.tasks.length === 0) {
            log.info(`You dont have any tasks, try adding one.`.blue, 'blue');
            process.exit(1);
        }

        let choices = list.tasks.map((item: TodoTask, index: number) => {
            let labels = '';
            (item.labels as TodoLabel[]).forEach((label) => {
                labels += getLabel(label.color, label.title) + ' ';
            });

            return {
                name: `${index + 1} ${item.title} ${labels}`,
                value: index,
                checked: item.done
            };
        });

        let answers = await prompts.prompt([
            {type: 'checkbox', name: 'checked', message: 'Check/uncheck finished tasks.', choices: choices }
        ]);

        if (typeof Model.tasks.check === 'function') {
            Model.tasks.check(answers.checked);
        }
        Tasks.show();
    },
    async selectIndex(message: string) {
        let list = Tasks.getCurrent();

        return selectOne(list.tasks, {
            message,
            emptyMessage: 'You dont have any tasks, try adding one.',
            getChoiceName: getTaskChoice
        });
    },
    async selectIndexes(message: string) {
        let list = Tasks.getCurrent();

        return selectMany(list.tasks, {
            message,
            emptyMessage: 'You dont have any tasks, try adding one.',
            getChoiceName: getTaskChoice
        });
    },
    async remove() {
        let indexes = await Tasks.selectIndexes('Select tasks to remove.');

        [...indexes]
            .sort((left: number, right: number) => right - left)
            .forEach((position: number) => {
                Tasks.get(position);
                Model.tasks.remove(position);
            });
        log.info(`${indexes.length} ${indexes.length === 1 ? 'task has' : 'tasks have'} been removed.`.blue, 'blue');

        Tasks.show();
    },
    async details() {
        let selectedIndex = await Tasks.selectIndex('Select a task.');
        let item = Tasks.get(selectedIndex);
        log('Title'.gray);
        log(item.title.cyan, 4);
        if (item.description.trim().length > 0) {
            log('Description'.gray);
            log(item.description, 4);
        }
        if (item.labels.length > 0) {
            log('Labels'.gray);
            let labels = '';
            (item.labels as TodoLabel[]).forEach((label) => {
                labels += getLabel(label.color, label.title) + ' ';
            });
            log(labels, 4);
        }
    },
    async edit() {
        let selectedIndex = await Tasks.selectIndex('Select a task.');
        let item = Tasks.get(selectedIndex);
        let list = Tasks.getCurrent();

        let questions: PromptQuestions = [
            { type: 'input', name: 'title', message: 'Title of the task', suffix: ' (required)', validate: required('title'), default: item.title},
            { type: 'input', name: 'description', message: 'Description of the task', default: item.description}
        ];

        if (list.labels.length > 0) {
            let choices = list.labels.map((label: TodoLabel) => {

                return {
                    name: getLabel(label.color, label.title),
                    value: label,
                    checked: !isUndefined(find(item.labels, label))
                };
            });
            questions.push({type: 'checkbox', name: 'labels', message: 'Add labels to the task.', choices: choices });
        }

        let answers = await prompts.prompt(questions);
        Model.tasks.edit(selectedIndex, answers);
        Tasks.show();
    },
    async actions(_args: unknown, opts: CommandOptions) {
        switch (true) {
            case !isUndefined(opts.add): await Tasks.add(); break;
            case !isUndefined(opts.details): await Tasks.details(); break;
            case !isUndefined(opts.show): Tasks.show(); break;
            case !isUndefined(opts.remove): await Tasks.remove(); break;
            case !isUndefined(opts.check): await Tasks.check(); break;
            case !isUndefined(opts.edit): await Tasks.edit(); break;
            default: Tasks.show(); break;
        }
    }
};

export default Tasks;
