import includes from 'lodash/includes.js';
import loadDb from './load-db.ts';
import * as __cjsImport138 from './persistence-sync.ts';
const { createCollectionPersistenceNotifier } = __cjsImport138;
type ListItem = Record<string, unknown> & {
    $id?: string | number;
    title?: string;
    description?: string;
    current?: boolean;
    index?: number;
    labels?: unknown[];
    done?: boolean;
    [key: string]: any;
};

type Collection = {
    get: (...args: any[]) => any;
    find: (...args: any[]) => any[];
    findOne: (...args: any[]) => any;
    add: (...args: any[]) => any;
    update: (...args: any[]) => any;
    remove: (item: ListItem) => void;
    count: () => number;
};

type Database = {getCollection: (name: string) => Collection};
type ListModel = {
    collection: Collection;
    get: (...args: any[]) => any;
    find: (...args: any[]) => any[];
    findOne: (...args: any[]) => any;
    add: (...args: any[]) => any;
    save: (...args: any[]) => any;
    remove: (item?: ListItem) => void;
    getCurrent: () => any;
    getFirst: () => any;
    getLast: () => any;
    updateIndexes: () => void;
    use: (id: string | number) => ListItem;
    [key: string]: any;
};

type NestedCollectionOptions = {
    withCheck?: boolean;
    prepareAdd?: (item: ListItem) => ListItem;
};

type NestedCollection = {
    add: (item: ListItem) => ListItem;
    remove: (index?: number) => ListItem | void;
    edit: (index: number, values: ListItem) => ListItem;
    reorder: (input?: {fromIndex?: number; toIndex?: number}) => ListItem;
    check?: (checked: number[]) => ListItem;
};

type CreateListModelOptions = {
    dbName: string;
    collectionName: string;
    itemKey: string;
    itemHasCheck?: boolean;
};

function createNestedCollection(Model: ListModel, key: string, options: NestedCollectionOptions = {}) {
    function assertPosition(index: unknown) {
        let current = Model.getCurrent();
        let items: ListItem[] = Array.isArray(current && current[key]) ? current[key] as ListItem[] : [];
        let position = Number.isInteger(index) ? index as number : null;

        if (position === null || position < 1 || position > items.length) {
            throw new Error(`Invalid ${key} position`);
        }

        return {current, items: items as ListItem[]};
    }

    let nestedCollection: NestedCollection = {
        add(item: ListItem) {
            let current = Model.getCurrent();
            let value = options.prepareAdd ? options.prepareAdd(item) : item;
            (current[key] as ListItem[]).push(value);
            return Model.save(current);
        },
        remove(index?: number) {
            if (typeof index === 'number') {
                let {current} = assertPosition(index);
                (current[key] as ListItem[]).splice(index - 1, 1);
                return Model.save(current);
            } else {
                let current = Model.getCurrent();
                current[key] = [];
                return Model.save(current);
            }
        },
        edit(index: number, values: ListItem) {
            let {current} = assertPosition(index);
            let item = (current[key] as ListItem[])[index - 1];
            Object.assign(item, values);
            return Model.save(current);
        },
        reorder({fromIndex, toIndex}: {fromIndex?: number; toIndex?: number} = {}) {
            let {current, items} = assertPosition(fromIndex);
            assertPosition(toIndex);
            let validFromIndex = fromIndex as number;
            let validToIndex = toIndex as number;

            if (validFromIndex === validToIndex) {
                return current;
            }

            let moved = items.splice(validFromIndex - 1, 1)[0];
            items.splice(validToIndex - 1, 0, moved);
            return Model.save(current);
        }
    };

    if (options.withCheck) {
        nestedCollection.check = function (checked: number[]) {
            let current = Model.getCurrent();
            (current[key] as ListItem[]).forEach((item, index) => {
                item.done = includes(checked, index);
            });
            return Model.save(current);
        };
    }

    return nestedCollection;
}

function createListModel({dbName, collectionName, itemKey, itemHasCheck = false}: CreateListModelOptions) {
    let DB = loadDb(dbName) as Database;

    let afterPersist = createCollectionPersistenceNotifier(dbName, collectionName);

    let Model: ListModel = {
        collection: DB.getCollection(collectionName),
        get(id: string | number) {
            return Model.collection.get(id);
        },
        find(query: Record<string, unknown> = {}, options: Record<string, unknown> = {sort: {index: 1}}) {
            return Model.collection.find(query, options);
        },
        findOne(query: Record<string, unknown> = {}, options: Record<string, unknown> = {sort: {index: 1}}) {
            return Model.collection.findOne(query, options);
        },
        add(item: ListItem) {
            let index = Model.collection.count() + 1;

            let doc = {
                title: typeof item.title === 'string' ? item.title.trim() : '',
                description: typeof item.description === 'string' ? item.description.trim() : '',
                [itemKey]: [],
                labels: [],
                current: false,
                index: index
            };

            let insertedDocument = Model.collection.add(doc);
            if (typeof insertedDocument.$id !== 'string' && typeof insertedDocument.$id !== 'number') {
                throw new Error('Inserted list is missing an id');
            }

            return Model.use(insertedDocument.$id);
        },
        save(item: ListItem) {
            let saved = Model.collection.update(item);
            afterPersist('save');
            return saved;
        },
        remove(item?: ListItem) {
            if (item === void 0) {
                Model.collection.find().forEach((item) => Model.collection.remove(item));
                afterPersist('remove');
                return;
            }

            Model.collection.remove(item);
            Model.updateIndexes();
            afterPersist('remove');
        },
        getCurrent() {
            return Model.findOne({current: true});
        },
        getFirst() {
            return Model.findOne();
        },
        getLast() {
            let lists = Model.find();
            return lists[lists.length - 1];
        },
        updateIndexes() {
            let items = Model.find();
            items.forEach((item, index) => {
                item.index = index + 1;
                Model.collection.update(item);
            });
        },
        use(id: string | number) {
            let prevCurrent = Model.find({current: true});
            prevCurrent.forEach((item) => {
                item.current = false;
                Model.collection.update(item);
            });

            let current = Model.get(id);
            current.current = true;
            let saved = Model.collection.update(current);
            afterPersist('use');
            return saved;
        }
    };

    Model[itemKey] = createNestedCollection(Model, itemKey, {
        withCheck: itemHasCheck,
        prepareAdd(item: ListItem) {
            item.done = false;
            if (!item.labels) {
                item.labels = [];
            }
            return item;
        }
    });

    Model.labels = createNestedCollection(Model, 'labels');

    return Model;
}

export { createListModel };
export default createListModel;
