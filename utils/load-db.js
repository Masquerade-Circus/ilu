let IluDb = require('iludb');
let IluDbNodeJsonPlugin = require('iludb/plugins/iludb-node-json-plugin');
let {dbFilePath} = require('./local-paths');
IluDb.use(IluDbNodeJsonPlugin);

module.exports = (dbname) => IluDb(dbFilePath(dbname));
