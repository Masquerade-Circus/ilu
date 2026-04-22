let includes = require('lodash/includes');
let loadDb = require('./load-db');
let isUndefined = require('lodash/isUndefined');
let notifySync = require('../sync/ilu-hooks');

function detectDomain(dbName, collectionName) {
    return dbName || collectionName || 'data';
}

function createNestedCollection(Model, key, options = {}) {
    let nestedCollection = {
        add(item) {
            let current = Model.getCurrent();
            let value = options.prepareAdd ? options.prepareAdd(item) : item;
            current[key].push(value);
            return Model.save(current);
        },
        remove(index) {
            let current = Model.getCurrent();
            if (typeof index === 'number') {
                current[key].splice(index - 1, 1);
            } else {
                current[key] = [];
            }
            return Model.save(current);
        },
        edit(index, values) {
            let current = Model.getCurrent();
            let item = current[key][index - 1];
            if (!isUndefined(item)) {
                Object.assign(item, values);
            }
            return Model.save(current);
        }
    };

    if (options.withCheck) {
        nestedCollection.check = function (checked) {
            let current = Model.getCurrent();
            current[key].forEach((item, index) => {
                item.done = includes(checked, index);
            });
            return Model.save(current);
        };
    }

    return nestedCollection;
}

module.exports = function createListModel({dbName, collectionName, itemKey, itemHasCheck = false}) {
    let DB = loadDb(dbName);
    let domain = detectDomain(dbName, collectionName);

    function afterPersist(action) {
        notifySync({domain, action});
    }

    let Model = {
        collection: DB.getCollection(collectionName),
        get(id) {
            return Model.collection.get(id);
        },
        find(query = {}, options = {sort: {index: 1}}) {
            return Model.collection.find(query, options);
        },
        findOne(query = {}, options = {sort: {index: 1}}) {
            return Model.collection.findOne(query, options);
        },
        add(item) {
            let index = Model.collection.count() + 1;

            let doc = {
                title: item.title.trim() || '',
                description: item.description.trim() || '',
                [itemKey]: [],
                labels: [],
                current: false,
                index: index
            };

            let insertedDocument = Model.collection.add(doc);
            return Model.use(insertedDocument.$id);
        },
        save(item) {
            let saved = Model.collection.update(item);
            afterPersist('save');
            return saved;
        },
        remove(item) {
            if (isUndefined(item)) {
                Model.collection.find().forEach(item => Model.collection.remove(item));
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
        use(id) {
            let prevCurrent = Model.find({current: true});
            prevCurrent.forEach(item => {
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
        prepareAdd(item) {
            item.done = false;
            if (!item.labels) {
                item.labels = [];
            }
            return item;
        }
    });

    Model.labels = createNestedCollection(Model, 'labels');

    return Model;
};
