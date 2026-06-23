let prompts = require('./prompts');
let {log} = require('./');

function ensureItems(items: any, emptyMessage: any) {
    if (items.length === 0) {
        log.info(emptyMessage.blue, 'blue');
        process.exit(1);
        return false;
    }

    return true;
}

function getChoices(items: any, getChoiceName: any) {
    return items.map((item: any, index: any) => ({
        name: getChoiceName(item, index),
        value: index + 1
    }));
}

function filterChoices(choices: any, search: any) {
    let normalizedSearch = String(search || '').trim().toLowerCase();

    if (normalizedSearch.length === 0) {
        return choices;
    }

    return choices.filter((choice: any) => choice.name.toLowerCase().includes(normalizedSearch));
}

async function selectOne(items: any, {message, emptyMessage, getChoiceName}: any) {
    if (!ensureItems(items, emptyMessage)) {
        return;
    }

    let answers = await prompts.prompt([
        {
            type: 'search',
            name: 'index',
            message,
            choices: getChoices(items, getChoiceName)
        }
    ]);

    return answers.index;
}

async function selectMany(items: any, {message, emptyMessage, getChoiceName}: any) {
    if (!ensureItems(items, emptyMessage)) {
        return;
    }

    let answers = await prompts.prompt([
        {
            type: 'checkbox',
            name: 'indexes',
            message,
            choices: getChoices(items, getChoiceName),
            validate(value: any) {
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
