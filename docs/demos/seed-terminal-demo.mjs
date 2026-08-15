import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sandboxHome = path.join(repoRoot, ".tmp", "capture", "home");
const storageDir = path.join(sandboxHome, ".ilu");
const configDir = path.join(storageDir, ".config");
const fixtureTimestamp = "2026-01-15T12:00:00.000Z";

if (!sandboxHome.startsWith(path.join(repoRoot, ".tmp") + path.sep)) {
  throw new Error("Capture HOME must remain inside the repository .tmp directory.");
}

fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });

const fixtures = {
  "todos.json": [
    {
      $id: 1,
      title: "Today",
      description: "Release documentation tasks",
      current: true,
      index: 1,
      labels: [],
      tasks: [
        {
          title: "Prepare release notes",
          description: "Summarize the release for README readers.",
          done: false,
          labels: []
        },
        {
          title: "Capture terminal demo",
          description: "Record the local TUI with synthetic fixtures.",
          done: false,
          labels: []
        },
        {
          title: "Verify local setup",
          description: "Confirm the documented commands from a clean checkout.",
          done: true,
          labels: []
        }
      ]
    },
    {
      $id: 2,
      title: "Later",
      description: "Follow-up documentation tasks",
      current: false,
      index: 2,
      labels: [],
      tasks: [
        {
          title: "Refine command examples",
          description: "Keep examples short and reproducible.",
          done: false,
          labels: []
        }
      ]
    }
  ],
  "notes.json": [
    {
      $id: 1,
      title: "Release notes",
      description: "Notes for the documentation release",
      current: true,
      index: 1,
      labels: [],
      notes: [
        {
          title: "README tone",
          content: "Keep the setup direct, calm, and specific.",
          labels: []
        },
        {
          title: "Capture checklist",
          content: "Use synthetic data and verify every exported asset.",
          labels: []
        }
      ]
    }
  ],
  "boards.json": [
    {
      $id: 1,
      title: "Release docs",
      description: "Documentation work for the next release.",
      current: true,
      index: 1,
      defaultColumnId: "backlog",
      columns: [
        {
          id: "backlog",
          title: "Backlog",
          wipLimit: null,
          index: 1,
          cards: [
            {
              title: "Tighten install copy",
              description: "Make the install path precise and easy to scan.",
              position: 1
            },
            {
              title: "Add first-run notes",
              description: "Explain what appears after the first launch.",
              position: 2
            }
          ]
        },
        {
          id: "ready",
          title: "Ready",
          wipLimit: 3,
          index: 2,
          cards: [
            {
              title: "Capture terminal demo",
              description: "Record the real TUI with synthetic data.",
              position: 1
            },
            {
              title: "Review alt text",
              description: "Describe the workflow without visual assumptions.",
              position: 2
            }
          ]
        },
        {
          id: "in-progress",
          title: "In Progress",
          wipLimit: 2,
          index: 3,
          cards: [
            {
              title: "Polish README visuals",
              description: "Keep the visual hierarchy focused on the TUI.",
              position: 1
            }
          ]
        },
        {
          id: "done",
          title: "Done",
          wipLimit: null,
          index: 4,
          cards: [
            {
              title: "Verify local setup",
              description: "Run the documented local commands.",
              position: 1
            }
          ]
        }
      ]
    },
    {
      $id: 2,
      title: "Ideas",
      description: "Possible documentation improvements.",
      current: false,
      index: 2,
      defaultColumnId: "backlog",
      columns: [
        { id: "backlog", title: "Backlog", wipLimit: null, index: 1, cards: [] },
        { id: "ready", title: "Ready", wipLimit: null, index: 2, cards: [] },
        { id: "in-progress", title: "In Progress", wipLimit: null, index: 3, cards: [] },
        { id: "done", title: "Done", wipLimit: null, index: 4, cards: [] }
      ]
    }
  ],
  "clocks.json": [
    { name: "Mexico City", timezone: "America/Mexico_City" },
    { name: "London", timezone: "Europe/London" },
    { name: "Tokyo", timezone: "Asia/Tokyo" }
  ]
};

function iluDatabase(collectionName, rows) {
  return {
    revision: 0,
    createdAt: fixtureTimestamp,
    modifiedAt: fixtureTimestamp,
    collections: {
      [collectionName]: {
        data: rows.map((row) => ({
          ...row,
          $createdAt: fixtureTimestamp,
          $modifiedAt: fixtureTimestamp
        })),
        index: rows.length,
        createdAt: fixtureTimestamp,
        modifiedAt: fixtureTimestamp
      }
    }
  };
}

for (const [filename, value] of Object.entries(fixtures)) {
  const collectionName = filename.replace(/\.json$/, "");
  const serializedValue = filename === "clocks.json" ? value : iluDatabase(collectionName, value);
  fs.writeFileSync(path.join(storageDir, filename), `${JSON.stringify(serializedValue, null, 2)}\n`, "utf8");
}

fs.writeFileSync(
  path.join(configDir, "sync-config.json"),
  `${JSON.stringify(
    {
      enabled: false,
      remoteUrl: null,
      branch: "main",
      autoSync: false,
      autoPull: false,
      autoPush: false
    },
    null,
    2
  )}\n`,
  { encoding: "utf8", mode: 0o600 }
);

process.stdout.write(`Synthetic capture HOME ready at ${path.relative(repoRoot, sandboxHome)}\n`);
