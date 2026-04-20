let createListModel = require('../utils/create-list-model');

module.exports = createListModel({
    dbName: 'notes',
    collectionName: 'notes',
    itemKey: 'notes'
});
