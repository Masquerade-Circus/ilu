import createListModel from '../utils/create-list-model.ts';

const Model = createListModel({
    dbName: 'notes',
    collectionName: 'notes',
    itemKey: 'notes'
});

export const collection = Model.collection;
export const get = Model.get;
export const find = Model.find;
export const findOne = Model.findOne;
export const add = Model.add;
export const save = Model.save;
export const remove = Model.remove;
export const getCurrent = Model.getCurrent;
export const getFirst = Model.getFirst;
export const getLast = Model.getLast;
export const updateIndexes = Model.updateIndexes;
export const use = Model.use;
export const notes = Model.notes;
export const labels = Model.labels;
export default Model;
