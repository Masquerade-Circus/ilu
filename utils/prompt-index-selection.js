let inquirer = require('./inquirer');
let {log} = require('./');

function ensureItems(items, emptyMessage) {
    if (items.length === 0) {
        log.info(emptyMessage.blue, 'blue');
        process.exit(1);
        return false;
    }

    return true;
}

function getChoices(items, getChoiceName) {
    return items.map((item, index) => ({
        name: getChoiceName(item, index),
        value: index + 1
    }));
}

async function selectOne(items, {message, emptyMessage, getChoiceName}) {
    if (!ensureItems(items, emptyMessage)) {
        return;
    }

    let answers = await inquirer.prompt([
        {
            type: 'select',
            name: 'index',
            message,
            choices: getChoices(items, getChoiceName)
        }
    ]);

    return answers.index;
}

async function selectMany(items, {message, emptyMessage, getChoiceName}) {
    if (!ensureItems(items, emptyMessage)) {
        return;
    }

    let answers = await inquirer.prompt([
        {
            type: 'checkbox',
            name: 'indexes',
            message,
            choices: getChoices(items, getChoiceName),
            validate(value) {
                return value.length > 0 || 'Please select at least one item';
            }
        }
    ]);

    return answers.indexes;
}

module.exports = {
    selectOne,
    selectMany
};
