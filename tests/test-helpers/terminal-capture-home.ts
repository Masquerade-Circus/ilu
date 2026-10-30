// Preload for the real Node CLI, after the capture backend has assigned its private HOME.
import { assertRepoTempHome } from "../../support/home-sandbox.ts";
import fs from "node:fs";
import path from "node:path";

assertRepoTempHome(process.env.HOME, "Physical capture HOME");
const { default: createListModel } = await import("../../utils/create-list-model.ts");
const { default: boards } = await import("../../scrumban/model.ts");
if (process.env.ILU_CAPTURE_EMPTY_HOME !== "1") {
  const document = Array.from({ length: 44 }, (_, index) => `Row${String(index + 1).padStart(2, "0")}`).join("\n");
  const todos = createListModel({ dbName: "todos", collectionName: "todos", itemKey: "tasks", itemHasCheck: true });
  todos.add({ title: "Capture Tasks", description: "" });
  todos.tasks.add({ title: "Capture task", description: document, done: false });
  const notes = createListModel({ dbName: "notes", collectionName: "notes", itemKey: "notes" });
  const current = notes.add({ title: "Capture Notes", description: "" });
  notes.notes.add({ title: "Capture note", content: document });
  notes.add({ title: "Archive Notes", description: "" });
  notes.notes.add({ title: "Archived note", content: "Synthetic archived content" });
  notes.use(current.$id);
  boards.add({
    title: "Capture Board",
    description: "",
    current: true,
    columns: [
      { id: "backlog", title: "Backlog" },
      { id: "ready", title: "Ready" }
    ]
  });
  boards.cards.add({ title: `Long ${"x".repeat(120)}`, description: document });
  boards.cards.add({ title: "Other", description: "" }, { columnIndex: 2 });
}

if (typeof process.env.ILU_CAPTURE_SEED_JSON === "string") {
  const seed = JSON.parse(process.env.ILU_CAPTURE_SEED_JSON);
  for (const key of Object.keys(seed)) {
    if (!["todos", "notes", "boards", "clocks", "ttsConfig"].includes(key)) {
      throw new Error(`Unsupported capture fixture requirement: ${key}`);
    }
  }
  const { default: loadDb } = await import("../../utils/load-db.ts");
  for (const domain of ["todos", "notes", "boards"]) {
    if (!Object.hasOwn(seed, domain)) {
      continue;
    }
    if (!Array.isArray(seed[domain])) {
      throw new Error(`Expected a capture fixture array for ${domain}`);
    }
    const collection = loadDb(domain).getCollection(domain);
    for (const record of collection.find()) {
      collection.remove(record);
    }
    for (const [index, record] of seed[domain].entries()) {
      if (domain === "boards") {
        const columns = record.columns.map((column, position) => ({
          id: column.id ?? `column-${position + 1}`,
          index: position + 1,
          wipLimit: null,
          ...column,
          cards: (column.cards ?? []).map((card, cardIndex) => ({ description: "", ...card, position: cardIndex + 1 }))
        }));
        collection.add({
          description: "",
          index: index + 1,
          defaultColumnId: columns[0]?.id ?? "",
          ...record,
          columns
        });
      } else {
        const itemKey = domain === "todos" ? "tasks" : "notes";
        const items = (record[itemKey] ?? []).map((item, position) => ({
          labels: [],
          index: position + 1,
          ...(domain === "todos" ? { description: "", done: false } : { content: "" }),
          ...item
        }));
        collection.add({ description: "", labels: [], index: index + 1, ...record, [itemKey]: items });
      }
    }
  }
  if (Object.hasOwn(seed, "clocks")) {
    if (!Array.isArray(seed.clocks)) {
      throw new Error("Expected a clocks capture fixture array");
    }
    fs.writeFileSync(path.join(process.env.HOME, ".ilu", "clocks.json"), JSON.stringify(seed.clocks));
  }
  if (Object.hasOwn(seed, "ttsConfig")) {
    const directory = path.join(process.env.HOME, ".ilu", ".config");
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(directory, "tts-config.json"), JSON.stringify(seed.ttsConfig), { mode: 0o600 });
  }
}
