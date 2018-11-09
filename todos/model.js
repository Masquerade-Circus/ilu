let includes = require('lodash/includes');
let {loadDb} = require('../utils');
let isUndefined = require('lodash/isUndefined');

let DB = loadDb('todos');

let Model = {
    collection: DB.getCollection("todos"),
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
            tasks: [],
            labels: [],
            current: false,
            index: index
        };

        let insertedDocument = Model.collection.add(doc);
        return Model.use(insertedDocument.$id);
    },
    save(item) {
        return Model.collection.update(item);
    },
    remove(item) {
        if (isUndefined(item)) {
            Model.collection.find().forEach(item => Model.collection.remove(item));
            return;
        }

        Model.collection.remove(item);
        Model.updateIndexes();
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
            Model.save(item);
        });
    },
    use(id) {
        let prevCurrent = Model.find({current: true});
        prevCurrent.map(item => {
            item.current = false;
            Model.save(item);
        });

        let current = Model.get(id);
        current.current = true;
        return Model.save(current);
    },
    tasks: {
        add(item) {
            let current = Model.getCurrent();
            item.done = false;
            if (!item.labels) {
                item.labels = [];
            }
            current.tasks.push(item);
            return Model.save(current);
        },
        check(checked) {
            let current = Model.getCurrent();
            current.tasks.forEach((item, index) => {
                item.done = includes(checked, index);
            });
            return Model.save(current);
        },
        remove(index) {
            let current = Model.getCurrent();
            if (typeof index === 'number') {
                current.tasks.splice(index - 1, 1);
            } else {
                current.tasks = [];
            }
            return Model.save(current);
        },
        edit(index, values) {
            let current = Model.getCurrent();
            let item = current.tasks[index - 1];
            if (!isUndefined(item)) {
                Object.assign(item, values);
            }
            return Model.save(current);
        }
    },
    labels: {
        add(item) {
            let current = Model.getCurrent();
            current.labels.push(item);
            return Model.save(current);
        },
        remove(index) {
            let current = Model.getCurrent();
            if (typeof index === 'number') {
                current.labels.splice(index - 1, 1);
            } else {
                current.labels = [];
            }
            return Model.save(current);
        },
        edit(index, values) {
            let current = Model.getCurrent();
            let item = current.labels[index - 1];
            if (!isUndefined(item)) {
                Object.assign(item, values);
            }
            return Model.save(current);
        }
    }
};

module.exports = Model;
