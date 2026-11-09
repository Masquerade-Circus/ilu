import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { captureIluScenario } from "./test-helpers/terminal-capture.ts";
import { captureCommand, assertCaptureArtifacts } from "./test-helpers/terminal-capture-scenarios.ts";

test("physical capture Notes list, selector, manager and editor preserve real navigation and cancel", async (context) => {
  const result = await captureIluScenario({
    testName: context.name,
    scenario: "notesFocus",
    command: captureCommand,
    viewport: { cols: 80, rows: 24 }
  });
  assert.equal(result.exitCode, 0);
  assertCaptureArtifacts({
    result,
    testName: context.name,
    checkpoints: ["notes-list", "notes-selector-focus", "notes-list-focus", "notes-manager", "notes-editor-focus"],
    diagnostic: (message) => context.diagnostic(message)
  });
});
for (const domain of ["Todo", "Notes"]) {
  test(`physical capture ${domain} editor preserves resize, cancellation and multiline persistence`, async (context) => {
    const result = await captureIluScenario({
      testName: context.name,
      scenario: "listEditor",
      input: { domain },
      command: captureCommand,
      viewport: { cols: 80, rows: 24 }
    });
    assert.equal(result.exitCode, 0);
    assertCaptureArtifacts({
      result,
      testName: context.name,
      checkpoints: ["editor-1", "editor-2", "editor-3", "editor-edited", "editor-saved"],
      diagnostic: (message) => context.diagnostic(message)
    });
  });
}

const exactContent = "\n  const value = 1;\n\n    return value;\n";
const seed = {
  todos: [
    {
      id: 1,
      title: "Today",
      current: true,
      tasks: ["First task", "Second task", "Third task", "Task 4", "Task 5", "Task 6"].map((title) => ({
        title,
        description: "Keep app shell clean",
        done: false
      }))
    },
    { id: 2, title: "Later", tasks: [{ title: "Later task", done: false }] }
  ],
  notes: [
    {
      id: "n1",
      title: "Research",
      current: true,
      notes: ["First note", "Second note", "Third note", "Note 4", "Note 5", "Note 6"].map((title, index) => ({
        title,
        content: index === 4 ? "Body 5" : "Line 1\nLine 2"
      }))
    },
    { id: "n2", title: "Archive", notes: [] }
  ]
};
// External changes write the real private DB through a separate writer after
// the dialog opens. remember/unchanged compare against those external bytes,
// not against the stale pre-conflict file. No model method is replaced.
const cases = [
  {
    name: "Todo UI keeps list management out of the main task surface",
    steps: [
      {
        expect: {
          texts: ["Today", "Later", "Manage lists"],
          absent: ["Current list:", "Todo lists", "Use list", "Rename list", "Remove list", "List:"]
        }
      }
    ]
  },
  {
    name: "Todo UI opens list manager as full-surface overlay with virtualized list actions",
    seed: { todos: seed.todos, notes: seed.notes },
    steps: [
      { remember: ["todos", "notes"] },
      { click: "Manage lists" },
      {
        expect: {
          texts: ["Todo lists", "Add list", "Rename list", "Delete list", "Close"],
          absent: "Use list",
          overlayFullSurface: true
        }
      },
      { screenshot: "manager-open" },
      { key: "ESCAPE" },
      { unchanged: ["todos", "notes"] }
    ]
  },
  {
    name: "Todo Enter toggles selected task instead of opening details",
    steps: [
      { click: "First task", area: "content" },
      { key: "ENTER" },
      { data: { domain: "todos", title: "First task", done: true } },
      { expect: { absent: "Edit task" } }
    ]
  },
  {
    name: "Todo Shift+Up and Shift+Down persist task order and keep moved task selected",
    steps: [
      { click: "First task", area: "content" },
      { key: "DOWN" },
      { key: "SHIFT_UP" },
      { data: { domain: "todos", firstTitles: ["Second task", "First task", "Third task"] } },
      { key: "SHIFT_DOWN" },
      { data: { domain: "todos", firstTitles: ["First task", "Second task", "Third task"] } },
      { key: "o" },
      { expect: { overlayTexts: ["Second task"] } },
      { key: "ESCAPE" }
    ]
  },
  {
    name: "Todo Shift reorder is scoped to task list and no-ops at boundaries",
    steps: [
      { click: "First task", area: "content" },
      { remember: ["todos"] },
      { key: "SHIFT_UP" },
      { click: "Add task" },
      { focusLabel: "Task details" },
      { key: "SHIFT_DOWN" },
      { unchanged: ["todos"] },
      { click: "Cancel" }
    ]
  },
  {
    name: "Notes UI keeps list management out of the main note surface",
    steps: [
      { key: "CTRL_2" },
      {
        expect: {
          texts: ["Research", "Manage lists"],
          absent: ["Current list:", "Note lists", "Use list", "Rename list", "Remove list", "List:"]
        }
      }
    ]
  },
  {
    name: "Notes UI opens list manager as full-surface overlay with virtualized list actions",
    seed: { todos: seed.todos, notes: seed.notes },
    steps: [
      { key: "CTRL_2" },
      { remember: ["todos", "notes"] },
      { click: "Manage lists" },
      {
        expect: {
          texts: ["Note lists", "Add list", "Rename list", "Delete list", "Close"],
          absent: "Use list",
          overlayFullSurface: true
        }
      },
      { screenshot: "manager-open" },
      { key: "ESCAPE" },
      { unchanged: ["todos", "notes"] }
    ]
  },
  {
    name: "Notes Shift+Up and Shift+Down persist note order and keep moved note selected",
    steps: [
      { key: "CTRL_2" },
      { click: "First note", area: "content" },
      { key: "DOWN" },
      { key: "SHIFT_UP" },
      { data: { domain: "notes", firstTitles: ["Second note", "First note", "Third note"] } },
      { key: "SHIFT_DOWN" },
      { data: { domain: "notes", firstTitles: ["First note", "Second note", "Third note"] } },
      { key: "ENTER" },
      { expect: { text: "Second note" } },
      { key: "ESCAPE" }
    ]
  },
  {
    name: "Notes Shift reorder is scoped to note list and no-ops at boundaries",
    steps: [
      { key: "CTRL_2" },
      { click: "First note", area: "content" },
      { remember: ["notes"] },
      { key: "SHIFT_UP" },
      { click: "Add note" },
      { focusLabel: "Note content" },
      { key: "SHIFT_DOWN" },
      { unchanged: ["notes"] },
      { click: "Cancel" }
    ]
  },
  {
    name: "Todo top list selector uses semantic buttons to switch lists",
    steps: [
      { click: "Later" },
      { data: { domain: "todos", currentTitle: "Later" } },
      { expect: { text: "Later task", absent: "First task" } }
    ]
  },
  {
    name: "Notes top list selector uses semantic buttons to switch lists",
    steps: [
      { key: "CTRL_2" },
      { click: "Archive" },
      { data: { domain: "notes", currentTitle: "Archive" } },
      { expect: { empty: true, absent: "First note" } }
    ]
  },
  {
    name: "Todo top list selector preserves local selection when switch action fails",
    steps: [
      { remember: ["todos"] },
      { storageFault: { domain: "todos", kind: "deny-write" } },
      { click: "Later" },
      { expect: { error: true, text: "First task" } },
      { unchanged: ["todos"] },
      { storageFault: { domain: "todos", kind: "restore" } },
      { click: "First task", area: "content" },
      { key: "o" },
      { expect: { overlayTexts: ["First task"] } },
      { key: "ESCAPE" }
    ]
  },
  {
    name: "Notes top list selector preserves local selection when switch action fails",
    steps: [
      { key: "CTRL_2" },
      { remember: ["notes"] },
      { storageFault: { domain: "notes", kind: "deny-write" } },
      { click: "Archive" },
      { expect: { error: true, text: "First note" } },
      { unchanged: ["notes"] },
      { storageFault: { domain: "notes", kind: "restore" } },
      { click: "First note", area: "content" },
      { key: "ENTER" },
      { expect: { overlayTexts: ["First note"] } },
      { key: "ESCAPE" }
    ]
  },
  { name: "Todo and Notes list selectors render null-id lists but block switch actions", importedIdentity: true },
  {
    name: "Notes click selects a note without opening details",
    steps: [
      { key: "CTRL_2" },
      { click: "First note" },
      { expect: { absent: "Note details" } },
      { key: "ENTER" },
      { expect: { text: "First note" } },
      { key: "ESCAPE" }
    ]
  },
  {
    name: "Todo UI exposes approved empty state and visible actions",
    seed: { ...seed, todos: [] },
    steps: [
      {
        expect: {
          empty: true,
          texts: ["Add task", "Manage lists"],
          absent: ["adapter", "snapshot", "runtime", "criteria"]
        }
      }
    ]
  },
  {
    name: "Todo add task overlay pins Save and Cancel to the overlay bottom",
    steps: [
      { click: "Add task" },
      { expect: { overlayBottomActions: ["Save", "Cancel"], withinViewport: true } },
      { screenshot: "overlay" },
      { click: "Cancel" }
    ]
  },
  {
    name: "Notes add note overlay pins Save and Cancel to the overlay bottom",
    steps: [
      { key: "CTRL_2" },
      { click: "Add note" },
      { expect: { overlayBottomActions: ["Save", "Cancel"], withinViewport: true } },
      { screenshot: "overlay" },
      { click: "Cancel" }
    ]
  },
  {
    name: "Todo UI opens add validation through visible controls without mutating on blank title",
    steps: [
      { remember: ["todos"] },
      { click: "Add task" },
      { click: "Save" },
      { expect: { invalid: true, text: "Cancel" } },
      { unchanged: ["todos"] },
      { screenshot: "rejection" },
      { click: "Cancel" }
    ]
  },
  {
    name: "Notes UI exposes approved actions and preserves multiline detail display",
    steps: [
      { key: "CTRL_2" },
      { click: "First note", area: "content" },
      { key: "ENTER" },
      {
        expect: {
          texts: ["Note details", "Note content", "Line 1", "Line 2"],
          absent: ["adapter", "snapshot", "runtime", "criteria"]
        }
      },
      { screenshot: "multiline-details" },
      { key: "ESCAPE" }
    ]
  },
  {
    name: "Notes UI uses approved empty state and visible list controls",
    seed: { ...seed, notes: [] },
    steps: [{ key: "CTRL_2" }, { expect: { empty: true, text: "Manage lists" } }]
  },
  {
    name: "Todo UI can operate on tasks beyond the first four via semantic list navigation",
    steps: [
      { click: "First task", area: "content" },
      { key: "DOWN", repeat: 4 },
      { key: "ENTER" },
      { data: { domain: "todos", title: "Task 5", done: true } },
      { expect: { absentPattern: "\\+\\d+ more" } }
    ]
  },
  {
    name: "Notes UI preserves content when editing a note beyond the first four",
    steps: [
      { key: "CTRL_2" },
      { click: "First note", area: "content" },
      { key: "DOWN", repeat: 4 },
      { key: "ENTER" },
      { click: "Edit note" },
      { click: "Save" },
      { data: { domain: "notes", title: "Note 5", content: "Body 5" } },
      { expect: { absentPattern: "\\+\\d+ more" } }
    ]
  },
  {
    name: "Notes UI preserves exact model content through snapshot edit save",
    seed: {
      ...seed,
      notes: [{ title: "Research", current: true, notes: [{ title: "Snippet", content: exactContent }] }]
    },
    steps: [
      { key: "CTRL_2" },
      { click: "Snippet", area: "content" },
      { key: "ENTER" },
      { click: "Edit note" },
      { click: "Save" },
      { data: { domain: "notes", title: "Snippet", content: exactContent } }
    ]
  },
  {
    name: "Todo visible action copy uses Reopen task for completed tasks",
    seed: { ...seed, todos: [{ title: "Today", current: true, tasks: [{ title: "Completed task", done: true }] }] },
    steps: [
      { click: "Completed task", area: "content" },
      { key: "o" },
      { expect: { text: "Reopen task", absent: "Mark open" } },
      { screenshot: "reopen-action" },
      { click: "Reopen task" },
      { data: { domain: "todos", title: "Completed task", done: false } },
      { key: "ESCAPE" }
    ]
  },
  {
    name: "Todo list switch resets stale task selection before the next task action",
    steps: [
      { click: "First task", area: "content" },
      { key: "DOWN", repeat: 4 },
      { click: "Later" },
      { click: "Later task", area: "content" },
      { key: "ENTER" },
      { data: { domain: "todos", list: "Later", title: "Later task", done: true } },
      { data: { domain: "todos", list: "Today", title: "Task 5", done: false } }
    ]
  },
  {
    name: "Notes list switch resets stale note selection and Enter requires an active note",
    steps: [
      { key: "CTRL_2" },
      { key: "DOWN", repeat: 4 },
      { click: "Archive" },
      { key: "ENTER" },
      { expect: { empty: true, absent: "Note details" } },
      { externalListChange: { domain: "notes", list: "Research", items: [{ title: "Fresh note", content: "" }] } },
      { click: "Research" },
      { key: "ENTER" },
      { expect: { absent: "Note 5" } },
      { key: "ESCAPE" }
    ]
  },
  {
    name: "Todo and Notes list selectors delegate long labels to Valyrian without manual ellipsis",
    seed: {
      todos: [
        {
          title: "Today list with an absurdly long title that used to punch through the panel width",
          current: true,
          tasks: []
        },
        seed.todos[1]
      ],
      notes: [
        {
          title: "Research list with an absurdly long title that used to punch through the panel width",
          current: true,
          notes: []
        },
        seed.notes[1]
      ]
    },
    steps: [
      { expect: { text: "Today list with an absurdly long title", absent: "…", withinViewport: true } },
      { key: "CTRL_2" },
      { expect: { text: "Research list with an absurdly long title", absent: "…", withinViewport: true } }
    ]
  },
  {
    name: "Todo keyboard details preserves completion until Enter or Space toggles it",
    steps: [
      { click: "First task", area: "content" },
      { remember: ["todos"] },
      { key: "o" },
      { expect: { text: "Keep app shell clean" } },
      { unchanged: ["todos"] },
      { key: "ESCAPE" },
      { click: "Second task", area: "content" },
      { key: "HOME" },
      { key: "ENTER" },
      { data: { domain: "todos", title: "First task", done: true } },
      { key: "SPACE" },
      { data: { domain: "todos", title: "First task", done: false } },
      { remember: ["todos"] },
      { click: "Add task" },
      { type: "Draft" },
      { key: "SPACE" },
      { type: "word" },
      { expect: { text: "Draft word" } },
      { screenshot: "space-input" },
      { click: "Cancel" },
      { unchanged: ["todos"] }
    ]
  },
  ...["Todo", "Notes"].flatMap((tab) => {
    const domain = tab === "Todo" ? "todos" : "notes";
    const key = tab === "Todo" ? "tasks" : "notes";
    const item = tab === "Todo" ? "task" : "note";
    const selectTab = { key: tab === "Todo" ? "CTRL_1" : "CTRL_2" };
    const lists = [
      {
        title: "First list",
        description: "Keep these details\nSecond line",
        current: true,
        [key]: [{ title: "Keep item", description: "Task details", content: "Note body" }]
      },
      { title: "Second list", description: "Second details", [key]: [] }
    ];
    return [
      {
        name: `${tab} rename through the TUI preserves stored list details`,
        seed: { ...seed, [domain]: lists },
        steps: [
          selectTab,
          { click: "Manage lists" },
          { click: "Rename list" },
          { fill: { label: "List title", text: "Renamed project" } },
          { click: "Rename list", area: "overlay", occurrence: -1 },
          { expect: { absent: "List title" } },
          { data: { domain, list: "Renamed project", description: "Keep these details\nSecond line" } }
        ]
      },
      {
        name: `${tab} browsing list manager does not change the active list`,
        seed: { ...seed, [domain]: lists },
        steps: [
          selectTab,
          { remember: [domain] },
          { click: "Manage lists" },
          { click: "Second list", area: "overlay" },
          { key: "ESCAPE" },
          { unchanged: [domain] },
          { click: "Manage lists" },
          { click: "Second list", area: "overlay" },
          { click: "Rename list" },
          { fill: { label: "List title", text: "Second renamed" } },
          { click: "Rename list", area: "overlay", occurrence: -1 },
          { expect: { absent: "List title" } },
          { data: { domain, currentTitle: "First list", list: "Second renamed", exists: true } }
        ]
      },
      ...["item", "list", "changed-item", "vanished-list"].map((target) => ({
        name: `${tab} failed ${target} removal stays identified and can retry or cancel`,
        seed: {
          ...seed,
          [domain]: [
            { ...lists[0], title: "Keep list" },
            { ...lists[1], title: "Other list" }
          ]
        },
        steps: [
          selectTab,
          ...(target.endsWith("list")
            ? [{ click: "Manage lists" }, { click: "Delete list" }]
            : [{ doubleClick: "Keep item" }, { click: `Remove ${item}` }]),
          {
            externalListChange: {
              domain,
              list: "Keep list",
              ...(target === "vanished-list"
                ? { remove: true }
                : {
                    description: "External edit",
                    ...(target === "changed-item"
                      ? {
                          prependItem: {
                            title: "Different item",
                            description: "Different",
                            content: "Different",
                            done: false
                          }
                        }
                      : {})
                  })
            }
          },
          { remember: [domain] },
          { click: target.endsWith("list") ? "Delete list" : `Remove ${item}`, area: "overlay" },
          { expect: { error: true, text: target.endsWith("list") ? "Keep list" : "Keep item" } },
          { unchanged: [domain] },
          { screenshot: "rejection" },
          ...(target === "changed-item" || target === "vanished-list"
            ? [
                { click: target.endsWith("list") ? "Delete list" : `Remove ${item}`, area: "overlay" },
                { unchanged: [domain] }
              ]
            : []),
          { click: "Cancel" },
          { unchanged: [domain] },
          ...(target === "vanished-list"
            ? [{ data: { domain, list: "Other list", exists: true } }]
            : target === "changed-item"
              ? [{ data: { domain, title: "Different item", exists: true } }]
              : [
                  ...(target === "list"
                    ? [{ click: "Manage lists" }, { click: "Delete list" }]
                    : [{ doubleClick: "Keep item" }, { click: `Remove ${item}` }]),
                  { click: target === "list" ? "Delete list" : `Remove ${item}`, area: "overlay" },
                  {
                    data: target === "list" ? { domain, absentList: "Keep list" } : { domain, absentItem: "Keep item" }
                  }
                ])
        ]
      })),
      ...["add-item", "edit-item", "add-list", "rename-list"].map((form) => ({
        name: `${tab} ${form} editor uses available height across resize without losing cancel or save`,
        seed: { ...seed, [domain]: lists },
        steps: [
          selectTab,
          {
            editorResizeRoundTrip: {
              domain,
              form,
              openViaVisibleControls: true,
              targetList: "First list",
              targetItem: "Keep item",
              draftTitle: "Draft title",
              documentLines: 64,
              sizes: [
                { cols: 80, rows: 24 },
                { cols: 100, rows: 40 },
                { cols: 80, rows: 24 }
              ],
              requireMoreLinesOnGrowth: true,
              requireSameLinesOnShrink: true,
              cancelPreservesBytes: true,
              saveExactDocument: true
            }
          }
        ]
      })),
      {
        name: `${tab} tall terminal shows more list entries without hiding actions`,
        seed: {
          ...seed,
          [domain]: [
            {
              title: "Entries",
              current: true,
              [key]: Array.from({ length: 24 }, (_, index) => ({
                title: `Entry-${index + 1}-end`,
                description: "",
                content: "",
                done: false
              }))
            }
          ]
        },
        steps: [
          selectTab,
          { rememberVisibleCount: { pattern: "Entry-\\d+-end", as: "short" } },
          { resize: { cols: 100, rows: 40 } },
          { expect: { moreVisibleThan: { name: "short", pattern: "Entry-\\d+-end" } } },
          { click: "Manage lists" },
          { expect: { text: "Close" } },
          { key: "ESCAPE" }
        ]
      }
    ];
  })
];

for (const entry of cases) {
  test(entry.name, async (context) => {
    if ("importedIdentity" in entry) {
      // IluDB rejects null document identities before a real selector can render.
      // Preserve the original fail-closed intent through imported files, not fake read models.
      const importedAt = "2026-01-01T00:00:00.000Z";
      const documents = Object.fromEntries(
        ["todos", "notes"].map((domain) => {
          const record: Record<string, unknown> = {
            $id: 1,
            $createdAt: importedAt,
            $modifiedAt: importedAt,
            title: `Imported ${domain}`,
            index: 1,
            current: true,
            [domain === "todos" ? "tasks" : "notes"]: []
          };
          const document = {
            collections: { [domain]: { data: [record], index: 1, createdAt: importedAt, modifiedAt: importedAt } },
            createdAt: importedAt,
            modifiedAt: importedAt,
            revision: 1
          };
          const valid = JSON.stringify(document);
          record.$id = null;
          return [domain, { valid, invalid: JSON.stringify(document) }];
        })
      );
      const result = await captureIluScenario({
        testName: context.name,
        scenario: "cliSequence",
        command: ["sh"],
        viewport: { cols: 120, rows: 48 },
        input: {
          cli: path.resolve(import.meta.dirname, "../bin/cli.js"),
          seed: {},
          files: { ".ilu/todos.json": documents.todos.invalid, ".ilu/notes.json": documents.notes.valid },
          commands: [
            { args: ["todo"] },
            {
              args: ["note"],
              before: [
                { files: { ".ilu/todos.json": documents.todos.valid, ".ilu/notes.json": documents.notes.invalid } }
              ]
            }
          ],
          watchedFiles: [".ilu/todos.json", ".ilu/notes.json"],
          syncFixture: null,
          external: { denyUnmatched: true },
          env: {},
          cwd: "home"
        }
      });
      assert.equal(result.exitCode, 0);
      assert.equal(result.observations.length, 2);
      for (const [index, domain] of ["todos", "notes"].entries()) {
        assert.equal(
          result.observations[index].exitCode,
          1,
          "An imported null document identity must block the real command"
        );
        assert.equal(
          result.observations[index].files[`.ilu/${domain}.json`],
          documents[domain].invalid,
          "Rejected imported data must stay intact"
        );
      }
      assert.equal(result.externalRequests.length, 0);
      assertCaptureArtifacts({
        result,
        testName: context.name,
        checkpoints: ["cli-1", "cli-2"],
        diagnostic: (message) => context.diagnostic(message)
      });
      return;
    }
    const result = await captureIluScenario({
      testName: context.name,
      scenario: "tuiInteraction",
      command: captureCommand,
      viewport: { cols: 80, rows: 24 },
      input: {
        seed: "seed" in entry ? entry.seed : seed,
        steps: [...entry.steps, { screenshot: "result" }],
        finish: "normal-exit"
      }
    });
    assert.equal(result.exitCode, 0);
    assertCaptureArtifacts({
      result,
      testName: context.name,
      checkpoints: ["result"],
      diagnostic: (message) => context.diagnostic(message)
    });
  });
}
