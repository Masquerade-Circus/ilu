let os = require('os');
let IluDb = require('iludb');
let IluDbNodeJsonPlugin = require('iludb/plugins/iludb-node-json-plugin');
IluDb.use(IluDbNodeJsonPlugin);

module.exports = (dbname) => IluDb(`${os.homedir()}/.ilu/${dbname}.json`);
