import includes from 'lodash/includes.js';
import loadDb from './load-db.ts';
import * as __cjsImport138 from './persistence-sync.ts';
const { createCollectionPersistenceNotifier } = __cjsImport138;
type CollectionId = string | number;

type NestedItem = Record<string, unknown> & {
    title: string;
    description: string;
    content: string;
    labels: unknown[];
    done: boolean;
};

type ListItem = Record<string, unknown> & {
    $id: CollectionId;
    title: string;
    description: string;
    current: boolean;
    index: number;
    labels: NestedItem[];
    tasks: NestedItem[];
    notes: NestedItem[];
};

type ListInput = {
    title?: string;
    description?: string;
};

type Collection = {
    get: (id: CollectionId) => ListItem;
    find: (query?: Record<string, unknown>, options?: Record<string, unknown>) => ListItem[];
    findOne: (query?: Record<string, unknown>, options?: Record<string, unknown>) => ListItem;
    add: (item: Record<string, unknown>) => ListItem;
    update: (item: ListItem) => ListItem;
    remove: (item: ListItem) => void;
    count: () => number;
};

type Database = {getCollection: (name: string) => Collection};
type ListModelCore = {
    collection: Collection;
    get: (id: CollectionId) => ListItem;
    find: (query?: Record<string, unknown>, options?: Record<string, unknown>) => ListItem[];
    findOne: (query?: Record<string, unknown>, options?: Record<string, unknown>) => ListItem;
    add: (item: ListInput) => ListItem;
    save: (item: ListItem) => ListItem;
    remove: (item?: ListItem) => void;
    getCurrent: () => ListItem;
    getFirst: () => ListItem;
    getLast: () => ListItem;
    updateIndexes: () => void;
    use: (id: CollectionId) => ListItem;
};

type ListModel<ItemKey extends string> = ListModelCore & {
    [Key in ItemKey | 'labels']: NestedCollection;
};

type NestedCollectionOptions = {
    withCheck?: boolean;
    prepareAdd?: (item: Record<string, unknown>) => NestedItem;
};

type NestedCollection = {
    add: (item: Record<string, unknown>) => ListItem;
    remove: (index?: number) => ListItem | void;
    edit: (index: number, values: Record<string, unknown>) => ListItem;
    reorder: (input?: {fromIndex?: unknown; toIndex?: unknown}) => ListItem;
    check?: (checked: number[]) => ListItem;
};

type CreateListModelOptions<ItemKey extends string = string> = {
    dbName: string;
    collectionName: string;
    itemKey: ItemKey;
    itemHasCheck?: boolean;
};

function requireCurrentList(Model: ListModelCore, key: string) {
    let current = Model.getCurrent();

    if (typeof current !== 'object' || current === null) {
        throw new Error(`Cannot access ${key} without a current list`);
    }

    return current;
}

function getNestedItems(current: ListItem, key: string) {
    let value = current[key];
    return Array.isArray(value) ? value as NestedItem[] : [];
}

function createNestedCollection(Model: ListModelCore, key: string, options: NestedCollectionOptions = {}) {
    function assertPosition(index: unknown) {
        let current = requireCurrentList(Model, key);
        let items = getNestedItems(current, key);
        let position = Number.isInteger(index) ? index as number : null;

        if (position === null || position < 1 || position > items.length) {
            throw new Error(`Invalid ${key} position`);
        }

        return {current, items};
    }

    let nestedCollection: NestedCollection = {
        add(item: Record<string, unknown>) {
            let current = requireCurrentList(Model, key);
            let items = getNestedItems(current, key);
            let value = options.prepareAdd ? options.prepareAdd(item) : item;
            items.push(value as NestedItem);
            current[key] = items;
            return Model.save(current);
        },
        remove(index?: number) {
            if (typeof index === 'number') {
                let {current} = assertPosition(index);
                getNestedItems(current, key).splice(index - 1, 1);
                return Model.save(current);
            } else {
                let current = requireCurrentList(Model, key);
                current[key] = [];
                return Model.save(current);
            }
        },
        edit(index: number, values: Record<string, unknown>) {
            let {current} = assertPosition(index);
            let item = getNestedItems(current, key)[index - 1];
            Object.assign(item, values);
            return Model.save(current);
        },
        reorder({fromIndex, toIndex}: {fromIndex?: unknown; toIndex?: unknown} = {}) {
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
            let current = requireCurrentList(Model, key);
            getNestedItems(current, key).forEach((item, index) => {
                item.done = includes(checked, index);
            });
            return Model.save(current);
        };
    }

    return nestedCollection;
}

function createListModel<ItemKey extends string>({dbName, collectionName, itemKey, itemHasCheck = false}: CreateListModelOptions<ItemKey>): ListModel<ItemKey> {
    let DB = loadDb(dbName) as Database;

    let afterPersist = createCollectionPersistenceNotifier(dbName, collectionName);

    let Model: ListModelCore = {
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
        add(item: ListInput) {
            let index = Model.collection.count() + 1;

            let doc: Record<string, unknown> = {
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
            return lists[lists.length - 1] as ListItem;
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

    return Object.assign(Model, {
        [itemKey]: createNestedCollection(Model, itemKey, {
            withCheck: itemHasCheck,
            prepareAdd(item: Record<string, unknown>) {
                item.done = false;
                if (!Array.isArray(item.labels)) {
                    item.labels = [];
                }
                return item as NestedItem;
            }
        }),
        labels: createNestedCollection(Model, 'labels')
    }) as ListModel<ItemKey>;
}

export { createListModel };
export default createListModel;
