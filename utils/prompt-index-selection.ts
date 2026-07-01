import prompts from './prompts.ts';
import * as __cjsImport140 from './index.ts';
const { log } = __cjsImport140;

type GetChoiceName<Item> = (item: Item, index: number) => string;

type SelectOptions<Item> = {
    message: string;
    emptyMessage: string;
    getChoiceName: GetChoiceName<Item>;
};

function ensureItems<Item>(items: Item[], emptyMessage: string) {
    if (items.length === 0) {
        log.info(emptyMessage.blue, 'blue');
        process.exit(1);
    }
}

function getChoices<Item>(items: Item[], getChoiceName: GetChoiceName<Item>) {
    return items.map((item, index) => ({
        name: getChoiceName(item, index),
        value: index + 1
    }));
}

async function selectOne<Item>(items: Item[], {message, emptyMessage, getChoiceName}: SelectOptions<Item>) {
    ensureItems(items, emptyMessage);

    let answers = await prompts.prompt([
        {
            type: 'search',
            name: 'index',
            message,
            choices: getChoices(items, getChoiceName)
        }
    ]) as {index: number};

    return answers.index;
}

async function selectMany<Item>(items: Item[], {message, emptyMessage, getChoiceName}: SelectOptions<Item>) {
    ensureItems(items, emptyMessage);

    let answers = await prompts.prompt([
        {
            type: 'checkbox',
            name: 'indexes',
            message,
            choices: getChoices(items, getChoiceName),
            validate(value: unknown) {
                return (Array.isArray(value) && value.length > 0) || 'Please select at least one item';
            }
        }
    ]) as {indexes: number[]};

    return answers.indexes;
}

export { selectOne, selectMany };
export default {
    selectOne,
    selectMany
};
