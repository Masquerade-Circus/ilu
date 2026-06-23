let isUndefined = require('lodash/isUndefined');
let prompts = require('../utils/prompts');
let {required, log, colors, getLabel} = require('../utils');
let Model = require('./model');
let {selectOne, selectMany} = require('../utils/prompt-index-selection');

function getListChoiceName(item: any) {
    return item.current ? `${item.index} ${item.title} (current)` : `${item.index} ${item.title}`;
}

async function selectListIndex(message: any) {
    return selectOne(Model.find(), {
        message,
        emptyMessage: 'You dont have any lists, try adding one.',
        getChoiceName: getListChoiceName
    });
}

async function selectListIndexes(message: any) {
    return selectMany(Model.find(), {
        message,
        emptyMessage: 'You dont have any lists, try adding one.',
        getChoiceName: getListChoiceName
    });
}

let Lists = {
    get(index: any) {
        let item = Model.findOne({index: index});
        if (!item) {
            log.warning(`The list "${index}" does not exists`.yellow, 'yellow');
            process.exit(1);
            return;
        }
        return item;
    },
    getCurrent() {
        let item = Model.getCurrent();
        if (!item) {
            log.info(`You dont have any lists, try adding one.`.blue, 'blue');
            process.exit(1);
            return;
        }
        return item;
    },
    async add() {
        let answers = await prompts
            .prompt([
                { type: 'input', name: 'title', message: 'Title of the list', suffix: ' (required)', validate: required('title')},
                { type: 'input', name: 'description', message: 'Description of the list'}
            ]);

        Model.add(answers);
        Lists.show();
    },
    async edit(index: any) {
        if (typeof index !== 'number') {
            index = await selectListIndex('Select the list to edit');
        }

        let item = Lists.get(index);
        let answers = await prompts
            .prompt([
                { type: 'input', name: 'title', message: 'Title of the list', suffix: ' (required)', validate: required('title'), default: item.title},
                { type: 'input', name: 'description', message: 'Description of the list', default: item.description}
            ]);

        Object.assign(item, answers);
        Model.save(item);
        Lists.show();
    },
    show() {
        let lists = Model.find();

        if (lists.length === 0) {
            log.info(`You dont have any lists, try adding one.`.blue, 'blue');
            process.exit(1);
            return;
        }

        lists.forEach((item: any) => {
            let str = `${item.index} ${item.title}`;
            if (item.current) {
                log.pointerSmall(str.cyan + ' (current)'.gray, 'cyan');
                return;
            }
            log.pointerSmall(str);
        });
    },
    async use(index: any) {
        if (typeof index !== 'number') {
            index = await selectListIndex('Select the list to use');
        }

        let item = Lists.get(index);
        Model.use(item.$id);
        Lists.show();
    },
    async remove(index: any) {
        let indexes = typeof index === 'number'
            ? [index]
            : await selectListIndexes('Select the lists to remove');

        let items = indexes.map((index: any) => Lists.get(index));

        items.forEach((item: any) => {
            Model.remove(item);
        });

        let current = Model.getCurrent();
        if (!current) {
            let first = Model.getFirst();
            if (first) {
                Model.use(first.$id);
            }
        }

        let message = indexes.length === 1
            ? `The list "${indexes[0]}" has been removed.`
            : `${indexes.length} lists have been removed.`;
        log.info(message.blue, 'blue');

        Lists.show();
    },
    async details(index: any) {
        if (typeof index !== 'number') {
            index = await selectListIndex('Select the list to show');
        }

        let item = Lists.get(index);
        log('Title'.gray);
        log(item.title.cyan, 4);

        if (item.description.trim().length > 0) {
            log('Description'.gray);
            log(item.description.cyan, 4);
        }

        if (item.tasks.length > 0) {
            log('Tasks'.gray);
            item.tasks.forEach((task: any, index: any) => {
                let str = `${index + 1} ${task.title}`;
                if (task.done) {
                    log.radioOn(str.cyan, 'green', 4);
                    return;
                }
                log.radioOff(str, 'white', 4);
            });
        }

        if (item.labels.length > 0) {
            log('Labels'.gray);
            let labels = '';
            item.labels.forEach((label: any, index: any) => {
                labels += getLabel(label.color, `${index + 1} ${label.title}`) + ' ';
            });
            log(labels, 4);
        }

    },
    async current() {
        let item = Lists.getCurrent();
        await Lists.details(item.index);
    },
    getLabel(index: any) {
        let list = Lists.getCurrent();
        let item = list.labels[index - 1];
        if (!item) {
            log.cross(`The label "${index}" does not exists`.red, 'red');
            process.exit(1);
            return;
        }

        return item;
    },
    async addLabel() {
        Lists.getCurrent();

        let choices = Object.keys(colors).map((color: any) => {
            let bgColor = `bg${color}`;
            return {
                name: getLabel(color, color),
                value: bgColor
            };
        });

        let answers = await prompts
            .prompt([
                { type: 'input', name: 'title', message: 'Title of the label', suffix: ' (required)', validate: required('title')},
                { type: 'select', name: 'color', message: 'Background color of the label', choices}
            ]);

        Model.labels.add(answers);
        Lists.current();
    },
    async editLabel(index: any) {
        Lists.getCurrent();
        let label = Lists.getLabel(index);

        let choices = Object.keys(colors).map((color: any) => {
            let bgColor = `bg${color}`;
            return {
                name: getLabel(color, color),
                value: bgColor
            };
        });

        let answers = await prompts
            .prompt([
                { type: 'input', name: 'title', message: 'Title of the label', suffix: ' (required)', validate: required('title'), default: label.title},
                { type: 'select', name: 'color', message: 'Background color of the label', choices}
            ]);

        Model.labels.edit(index, answers);
        Lists.current();
    },
    removeLabel(index: any) {
        if (typeof index === 'number') {
            Lists.getLabel(index);
            Model.labels.remove(index);
            log.info(`The label "${index}" has been removed.`.blue, 'blue');
        } else {
            Model.labels.remove();
            log.info(`All the labels have been removed.`.blue, 'blue');
        }
        Lists.current();
    },
    async actions(args: any, opts: any) {
        try {
            switch (true) {
                case !isUndefined(opts.add): await Lists.add(); break;
                case !isUndefined(opts.edit): await Lists.edit(opts.edit); break;
                case !isUndefined(opts.details): await Lists.details(opts.details); break;
                case !isUndefined(opts.show): Lists.show(); break;
                case !isUndefined(opts.use): await Lists.use(opts.use); break;
                case !isUndefined(opts.remove): await Lists.remove(opts.remove); break;
                case !isUndefined(opts.current): await Lists.current(); break;
                case !isUndefined(opts.addLabel): await Lists.addLabel(); break;
                case !isUndefined(opts.editLabel): await Lists.editLabel(opts.editLabel); break;
                case !isUndefined(opts.removeLabel): Lists.removeLabel(opts.removeLabel); break;
                default: Lists.show(); break;
            }
        } catch (error: any) {
            console.log(error);
        }

    }
};

module.exports = Lists;
