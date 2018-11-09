let os = require('os');
let OpusDb = require('opus-db');
let OpusDbNodeJsonPlugin = require('opus-db/plugins/opus-db-node-json-plugin');
OpusDb.use(OpusDbNodeJsonPlugin);

module.exports = (dbname) => OpusDb(`${os.homedir()}/.opus-notes/${dbname}.json`);
