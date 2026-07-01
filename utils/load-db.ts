import IluDb from 'iludb';
import IluDbNodeJsonPlugin from 'iludb/plugins/iludb-node-json-plugin.js';
import * as __cjsImport139 from './local-paths.ts';
const { dbFilePath } = __cjsImport139;
IluDb.use(IluDbNodeJsonPlugin);

export default (dbname: string) => IluDb(dbFilePath(dbname));
