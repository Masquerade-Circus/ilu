let createListModel = require('../utils/create-list-model');

module.exports = createListModel({
    dbName: 'todos',
    collectionName: 'todos',
    itemKey: 'tasks',
    itemHasCheck: true
});
