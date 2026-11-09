import assert from "node:assert/strict";
import path from "node:path";
import IluDb from "iludb";
import JsonPlugin from "iludb/plugins/node-json";
import { assertRepoTempHome } from "../../support/home-sandbox.ts";

const home = assertRepoTempHome(process.env.HOME, "External capture writer HOME");
const change = JSON.parse(process.argv[2]);
assert.ok(["todos", "notes", "boards"].includes(change.domain));
if (change.domain === "boards") {
  assert.equal(change.remove, true, "Board fixture changes only support removing a real stored board");
  assert.deepEqual(Object.keys(change).sort(), ["domain", "list", "remove"]);
}
assert.equal(typeof change.list, "string");
for (const key of Object.keys(change)) {
  assert.ok(["domain", "list", "remove", "description", "items", "prependItem"].includes(key));
}
IluDb.use(JsonPlugin);
const collection = IluDb(path.join(home, ".ilu", `${change.domain}.json`)).getCollection(change.domain);
const list = collection.findOne({ title: change.list });
assert.equal(typeof list, "object");
assert.notEqual(list, null);
if (change.remove === true) {
  collection.remove(list);
} else {
  const key = change.domain === "todos" ? "tasks" : "notes";
  const updated = { ...list };
  if (Object.hasOwn(change, "description")) {
    assert.equal(typeof change.description, "string");
    updated.description = change.description;
  }
  if (Object.hasOwn(change, "items")) {
    assert.ok(Array.isArray(change.items));
    updated[key] = change.items;
  }
  if (Object.hasOwn(change, "prependItem")) {
    assert.equal(typeof change.prependItem, "object");
    assert.notEqual(change.prependItem, null);
    updated[key] = [change.prependItem, ...updated[key]];
  }
  updated[key] = updated[key].map((item, index) => ({
    labels: [],
    ...(key === "tasks" ? { description: "", done: false } : { content: "" }),
    ...item,
    index: index + 1
  }));
  collection.update(updated);
}
