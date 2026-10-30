import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { execFileSync } from "node:child_process";
import { assertRepoTempHome } from "../../support/home-sandbox.ts";

export async function runAdapterBehavior(context, input) {
  if (input.area === "babel") {
    return runBabelAdapter(context, input);
  }
  if (input.area === "tts") {
    return runTtsAdapter(context, input);
  }
  assert.ok(["todo", "notes", "clocks"].includes(input.area), "Adapter area has not been integrated");
  const notes = input.area === "notes";
  const clocks = input.area === "clocks";
  const domain = clocks ? "clocks" : notes ? "notes" : "todos";
  const { app, screen, click, expectScreen } = context;
  const home = assertRepoTempHome(context.home);
  const workspace = path.dirname(path.dirname(home));
  const file = path.join(home, ".ilu", `${domain}.json`);
  const read = () => {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return clocks ? data : data.collections[domain].data;
  };
  const today = () => read().find((list) => list.title === (notes ? "Research" : "Today"));
  const titles = () => today()[notes ? "notes" : "tasks"].map((item) => item.title);
  const originalTasks = clocks ? [] : structuredClone(today()[notes ? "notes" : "tasks"]);
  const originalClocks = clocks ? fs.readFileSync(file, "utf8") : null;
  const observed = {};
  const quote = (value) => `'${String(value).replace(/'/g, `'"'"'`)}'`;
  let launches = 0;
  let status;
  const start = async () => {
    status = path.join(workspace, `adapter-ui-${++launches}.status`);
    const script = path.join(workspace, `adapter-ui-${launches}.sh`);
    const cli = path.resolve(import.meta.dirname, "..", "..", "bin", "cli.js");
    fs.writeFileSync(script, `printf '\\033[2J\\033[H'\nnode ${quote(cli)} ui\nprintf '%s' "$?" > ${quote(status)}\n`, {
      flag: "wx",
      mode: 0o600
    });
    await app.type(`. ../../adapter-ui-${launches}.sh`);
    await app.press("ENTER");
    await expectScreen((text) => text.includes("Add task"), "The real Todo workspace must start");
    if (notes) {
      await click("Notes");
      await expectScreen((text) => text.includes("Add note"), "The real Notes workspace must open");
    }
    if (clocks) {
      await app.press("CTRL_4");
      await expectScreen((text) => text.includes("Add clock"), "The real Clocks workspace must open");
    }
  };
  const stop = async () => {
    await click("Todo");
    await app.press("CTRL_C");
    const deadline = Date.now() + 8000;
    while (!fs.existsSync(status)) {
      assert.ok(Date.now() < deadline, "The workspace must exit through its keyboard action");
      await delay(25);
    }
    assert.equal(fs.readFileSync(status, "utf8"), "0");
  };
  const fill = async (label, value) => {
    await click(label, { rowOffset: 1, exact: true });
    await app.press("CTRL_A");
    await app.press("BACKSPACE");
    if (value.length > 0) {
      await app.type(value);
    }
  };
  await app.type("stty -echo; PS1=''");
  await app.press("ENTER");
  await start();
  await app.screenshot({ name: "condition" });
  switch (input.caseId) {
    case "clocks-invalid-input": {
      await click("Add clock");
      await app.type("   ");
      await click("Add clock", { area: "overlay", occurrence: -1 });
      await expectScreen((text) => /name.*required/i.test(text), "A blank clock name must be rejected");
      assert.equal(fs.readFileSync(file, "utf8"), originalClocks);
      await fill("Clock name", "Rejected zone");
      await fill("Time zone", "Invalid/Zone");
      await click("Add clock", { area: "overlay", occurrence: -1 });
      await expectScreen((text) => /choose a time zone/i.test(text), "A missing valid zone must be rejected");
      await click("Cancel");
      await click("1. UTC:");
      await expectScreen((text) => text.includes("Clock details"), "Boundary checks require a real selected clock");
      for (const direction of ["Move up", "Move down"]) {
        await click(direction, { area: "overlay" });
        await expectScreen(
          (text) => /another clock|already (first|last)/i.test(text),
          "Boundary movement must be rejected"
        );
        assert.equal(fs.readFileSync(file, "utf8"), originalClocks);
      }
      observed.invalidClockSaved = read().some(
        (clock) => clock.name.trim().length === 0 || clock.timezone === "Invalid/Zone"
      );
      observed.boundaryMovesChangedOrder = fs.readFileSync(file, "utf8") !== originalClocks;
      observed.clocksUnchanged = fs.readFileSync(file, "utf8") === originalClocks;
      await click("Close");
      await stop();
      fs.writeFileSync(file, "[]");
      await start();
      await click("Remove");
      await expectScreen(
        (text) => /choose a clock first/i.test(text),
        "Removing without a selectable clock must be rejected"
      );
      assert.deepEqual(read(), [], "The empty-list action must not create or remove clocks");
      break;
    }
    case "clocks-write-failure": {
      await click("Add clock");
      await app.type("London");
      await fill("Time zone", "Europe/London");
      await click("Europe/London", { occurrence: -1 });
      const directory = path.join(home, ".ilu", ".config");
      fs.mkdirSync(directory, { recursive: true });
      const mode = fs.statSync(directory).mode & 0o777;
      try {
        fs.chmodSync(directory, 0o500);
        await click("Add clock", { area: "overlay", occurrence: -1 });
        const failure = await expectScreen(
          (text) => /could not.*save|could not be saved|try again/i.test(text),
          "An actual clock write failure must remain visible"
        );
        observed.saveRejected = !read().some((clock) => clock.name === "London");
        observed.clocksUnchanged = fs.readFileSync(file, "utf8") === originalClocks;
        observed.leakedPrivateDetails = /EACCES|EPERM|\.ilu|node:|at create/i.test(failure);
      } finally {
        fs.chmodSync(directory, mode);
      }
      await click("Cancel");
      await app.press("CTRL_2");
      observed.applicationUsable = (
        await expectScreen((text) => text.includes("Add note"), "Navigation must work after a clock save failure")
      ).includes("Add note");
      await app.press("CTRL_4");
      break;
    }
    case "clocks-utc-search":
    case "clocks-normalized-crud": {
      const utc = input.caseId === "clocks-utc-search";
      await click("Add clock");
      await app.type(utc ? "UTC" : "  London  ");
      await fill("Time zone", utc ? "utc" : "Europe/London");
      const choices = await expectScreen(
        (text) => text.includes(utc ? "Etc/UTC" : "Europe/London"),
        "The timezone search must expose the requested choice"
      );
      await click(utc ? "Etc/UTC" : "Europe/London", { occurrence: -1 });
      await click("Add clock", { area: "overlay", occurrence: -1 });
      await expectScreen(
        (text) => !text.includes("Clock name") && text.includes(utc ? "Etc/UTC" : "London"),
        "The new clock must be saved"
      );
      if (utc) {
        observed.utcSearchResultsTruncated = !choices.includes("Etc/UTC");
        observed.savedClocks = read();
        await click("Etc/UTC");
        await app.press("ENTER");
        await expectScreen(
          (text) => text.includes("Clock details") && text.includes("Etc/UTC"),
          "Clock details must preserve the selected UTC alias"
        );
        observed.selectedTimezone = read()[0].timezone;
        await click("Close");
      } else {
        await stop();
        const statusFile = path.join(workspace, "clock-multi-remove.status");
        const script = path.join(workspace, "clock-multi-remove.sh");
        const cli = path.resolve(import.meta.dirname, "..", "..", "bin", "cli.js");
        fs.writeFileSync(
          script,
          `printf '\\033[2J\\033[H'\nnode ${quote(cli)} clock --remove\nprintf '%s' "$?" > ${quote(statusFile)}\n`,
          { flag: "wx", mode: 0o600 }
        );
        await app.type(". ../../clock-multi-remove.sh");
        await app.press("ENTER");
        await expectScreen(
          (text) => text.includes("Select clocks to remove"),
          "The public CLI must expose multiple clock selection"
        );
        for (const key of ["DOWN", "SPACE", "DOWN", "SPACE", "SPACE", "SPACE"]) {
          await app.press(key);
        }
        await app.screenshot({ name: "multiple-clock-selection" });
        await app.press("ENTER");
        const deadline = Date.now() + 8000;
        while (!fs.existsSync(statusFile)) {
          assert.ok(Date.now() < deadline, "The real multi-remove CLI must finish normally");
          await delay(25);
        }
        assert.equal(fs.readFileSync(statusFile, "utf8"), "0");
        assert.deepEqual(
          read().map((clock) => clock.name),
          ["UTC", "London"]
        );
        await start();
        await click("London:");
        await expectScreen(
          (text) => text.includes("Clock details") && text.includes("Europe/London"),
          "London details must open before moving the selected clock"
        );
        await click("Move up", { area: "overlay" });
        await click("Close");
        await expectScreen((text) => text.includes("1. London:"), "Clock order must update visibly");
        observed.savedClocks = read();
        await stop();
        await start();
        await expectScreen((text) => text.includes("1. London:"), "A fresh workspace must restore clock priority");
        observed.restoredClockNames = read().map((clock) => clock.name);
      }
      break;
    }
    case "notes-invalid-input": {
      await click("Add note");
      await fill("Note content", "Body");
      await click("Save");
      await expectScreen((text) => /title.*required/i.test(text), "An empty note title must be rejected");
      await click("Cancel");
      await click("Archive");
      const empty = await expectScreen(
        (text) => text.includes("Add note") && !text.includes("Threat model"),
        "The empty note list must remain usable without item actions"
      );
      observed.emptyListControlsUnavailable = !empty.includes("Edit note") && !empty.includes("Remove note");
      observed.archiveNotes = read().find((list) => list.title === "Archive").notes;
      await click("Research");
      observed.invalidNoteSaved = read().some((list) => list.notes.some((note) => note.title.trim().length === 0));
      observed.originalNotesUnchanged = JSON.stringify(today().notes) === JSON.stringify(originalTasks);
      break;
    }
    case "notes-invalid-reorder": {
      await click("Threat model");
      await app.press("SHIFT_UP");
      await click("Archive");
      await app.press("SHIFT_DOWN");
      observed.archiveNotes = read().find((list) => list.title === "Archive").notes;
      await click("Research");
      await click("Threat model");
      const before = titles();
      await app.press("x");
      await screen();
      observed.unrelatedKeyMovedNote = JSON.stringify(before) !== JSON.stringify(titles());
      observed.savedNoteTitles = titles();
      break;
    }
    case "notes-reorder-boundaries": {
      await click("Abuse cases");
      await app.press("SHIFT_UP");
      await expectScreen((text) => text.includes("1. Abuse cases"), "The moved note must appear first");
      observed.intermediateNoteTitles = titles();
      await app.press("HOME");
      await app.press("DOWN");
      await app.press("SHIFT_DOWN");
      await screen();
      observed.lowerBoundaryUnchanged = JSON.stringify(titles()) === JSON.stringify(observed.intermediateNoteTitles);
      await app.press("SHIFT_UP");
      await expectScreen((text) => text.includes("1. Threat model"), "The note order must be restored");
      observed.savedNoteTitles = titles();
      await stop();
      await start();
      await expectScreen((text) => text.includes("1. Threat model"), "A new workspace must restore note order");
      observed.restoredNoteTitles = titles();
      break;
    }
    case "notes-multiline-crud": {
      await click("Add note");
      await app.type("  New note  ");
      await fill("Note content", "Line A");
      await app.press("SHIFT_ENTER");
      await app.type("Line B");
      await click("Save");
      await expectScreen(
        (text) => text.includes("New note") && !text.includes("Cancel"),
        "The new note must be visible"
      );
      const added = today().notes.find((note) => note.title === "New note");
      assert.ok(added);
      observed.addedNote = { title: added.title, content: added.content };
      await click("Threat model");
      await app.press("ENTER");
      await click("Edit note");
      await fill("Note title", "  Edited  ");
      await fill("Note content", "First");
      await app.press("SHIFT_ENTER");
      await app.type("Second");
      await click("Save");
      await expectScreen(
        (text) => text.includes("Edited") && !text.includes("Cancel"),
        "The edited note must be visible"
      );
      const edited = today().notes.find((note) => note.title === "Edited");
      assert.ok(edited);
      observed.editedNote = { title: edited.title, content: edited.content, labels: edited.labels };
      await click("Abuse cases");
      await app.press("ENTER");
      await click("Remove note");
      await click("Remove note", { occurrence: -1 });
      await expectScreen(
        (text) => !text.includes("Abuse cases") && text.includes("Edited"),
        "The removed note must disappear"
      );
      observed.savedNoteTitles = titles();
      await stop();
      await start();
      await click("Edited");
      await app.press("ENTER");
      await expectScreen(
        (text) => text.includes("First") && text.includes("Second"),
        "The persisted multiline content must reopen"
      );
      observed.restoredEditedContent = today().notes.find((note) => note.title === "Edited").content;
      await click("Close");
      break;
    }
    case "todo-invalid-task": {
      await click("Add task");
      await app.type("   ");
      await click("Save");
      await expectScreen((text) => /title.*required/i.test(text), "Blank task input must be rejected");
      await click("Cancel");
      await click("Later");
      await app.press("o");
      await app.press("ENTER");
      await app.press("SPACE");
      await click("Task details (O)");
      observed.emptyListTasks = read().find((list) => list.title === "Later").tasks;
      await click("Today");
      observed.invalidTaskSaved = read().some((list) => list.tasks.some((task) => task.title.trim().length === 0));
      observed.originalTasksUnchanged = JSON.stringify(today().tasks) === JSON.stringify(originalTasks);
      break;
    }
    case "todo-invalid-reorder": {
      await click("Open task");
      await app.press("SHIFT_UP");
      await click("Later");
      await app.press("SHIFT_DOWN");
      observed.emptyListTasks = read().find((list) => list.title === "Later").tasks;
      await click("Today");
      await click("Open task");
      const before = titles();
      await app.press("x");
      observed.unrelatedKeyMovedTask = JSON.stringify(before) !== JSON.stringify(titles());
      observed.savedTaskTitles = titles();
      break;
    }
    case "todo-reorder-boundaries": {
      await click("Done task");
      await app.press("SHIFT_UP");
      await expectScreen((text) => text.includes("1. Done task"), "The moved task must appear first");
      observed.intermediateTaskTitles = titles();
      await app.press("HOME");
      await app.press("DOWN");
      await app.press("SHIFT_DOWN");
      await screen();
      observed.lowerBoundaryUnchanged = JSON.stringify(titles()) === JSON.stringify(observed.intermediateTaskTitles);
      await app.press("SHIFT_UP");
      await expectScreen((text) => text.includes("1. Open task"), "The task order must be restored visibly");
      observed.savedTaskTitles = titles();
      await stop();
      await start();
      await expectScreen(
        (text) => text.includes("1. Open task") && text.includes("2. Done task"),
        "A new workspace must restore the saved order"
      );
      observed.restoredTaskTitles = titles();
      break;
    }
    case "todo-crud-labels": {
      await click("Add task");
      await app.type("  Add UI  ");
      await fill("Task details", "  Details  ");
      await click("Save");
      await expectScreen(
        (text) => text.includes("Add UI") && !text.includes("Cancel"),
        "The submitted task must be visible after the editor closes"
      );
      const added = today().tasks.find((task) => task.title === "Add UI");
      assert.ok(added, "The submitted task must exist in storage");
      observed.addedTask = { title: added.title, description: added.description };
      await click("Open task");
      await app.press("o");
      await click("Edit task");
      await fill("Task title", "  Edited  ");
      await fill("Task details", "  New desc  ");
      await click("Save");
      await expectScreen(
        (text) => text.includes("Edited") && !text.includes("Cancel"),
        "The edited task must be visible after the editor closes"
      );
      const edited = today().tasks.find((task) => task.title === "Edited");
      assert.ok(edited, "The edited task must exist in storage");
      observed.editedTask = { title: edited.title, description: edited.description, labels: edited.labels };
      await click("Edited");
      await app.press("ENTER");
      await screen();
      observed.completedTitlesBeforeReopen = today()
        .tasks.filter((task) => task.done)
        .map((task) => task.title);
      await click("Done task");
      await app.press("ENTER");
      await screen();
      observed.completedTitlesAfterReopen = today()
        .tasks.filter((task) => task.done)
        .map((task) => task.title);
      await click("Edited");
      await app.press("o");
      await click("Remove task");
      await click("Remove task", { occurrence: -1 });
      await expectScreen(
        (text) => !text.includes("Edited") && text.includes("Add UI"),
        "The removed task must disappear from the list"
      );
      observed.savedTaskTitles = titles();
      await stop();
      await start();
      await expectScreen(
        (text) => text.includes("Add UI") && !text.includes("Edited"),
        "A new workspace must show the persisted removal"
      );
      observed.restoredTaskTitles = titles();
      break;
    }
    case "notes-list-management":
    case "todo-list-management": {
      const otherList = notes ? "Archive" : "Later";
      const newList = notes ? "Scratch" : "Inbox";
      const renamedTitle = `${otherList} renamed`;
      const fallback = notes ? "Research" : "Today";
      await click(otherList);
      await click("Manage lists");
      await click("Add list");
      await fill("List title", `  ${newList}  `);
      await fill("List details", notes ? "  Drafts  " : "  Capture  ");
      await click("Add list", { occurrence: -1 });
      await expectScreen(
        (text) => text.includes(newList) && !text.includes("List title"),
        "The new list must be visible after submission"
      );
      const added = read().find((list) => list.title === newList);
      assert.ok(added);
      observed.addedList = { title: added.title, description: added.description };
      await click("Manage lists");
      await click(otherList);
      await click("Rename list");
      await fill("List title", `  ${renamedTitle}  `);
      await fill("List details", notes ? "" : "  Queue  ");
      await click("Rename list", { occurrence: -1 });
      await expectScreen(
        (text) => text.includes(renamedTitle) && !text.includes("List title"),
        "The renamed list must be visible after submission"
      );
      const renamed = read().find((list) => list.title === renamedTitle);
      assert.ok(renamed);
      observed.renamedListBeforeRemoval = { title: renamed.title, description: renamed.description };
      await click(renamedTitle);
      await click("Manage lists");
      await click("Delete list");
      await click("Delete list", { occurrence: -1 });
      await expectScreen(
        (text) => !text.includes(renamedTitle) && text.includes(fallback),
        "The removed list must disappear"
      );
      observed.removedListPresent = read().some((list) => list.title === renamedTitle);
      observed.currentListTitle = read().find((list) => list.current)?.title;
      await stop();
      await start();
      await expectScreen(
        (text) => text.includes(fallback) && !text.includes(renamedTitle),
        "The fallback list must survive a restart"
      );
      observed.restoredCurrentListTitle = read().find((list) => list.current)?.title;
      break;
    }
    case "notes-write-failure":
    case "todo-write-failure": {
      await click(notes ? "Add note" : "Add task");
      const title = notes ? "Note" : "Rejected write";
      await app.type(title);
      if (notes) {
        await fill("Note content", "Body");
      }
      const directory = path.dirname(file);
      const mode = fs.statSync(directory).mode & 0o777;
      try {
        fs.chmodSync(directory, 0o500);
        await click("Save");
        const failure = await expectScreen(
          (text) => /could not be saved|try again/i.test(text),
          "A real write failure must be reported"
        );
        observed.saveRejected = !today()[notes ? "notes" : "tasks"].some((item) => item.title === title);
        observed[notes ? "originalNotesUnchanged" : "originalTasksUnchanged"] =
          JSON.stringify(today()[notes ? "notes" : "tasks"]) === JSON.stringify(originalTasks);
        observed.leakedPrivateDetails = /EACCES|EPERM|\.ilu|node:|at create/i.test(failure);
      } finally {
        fs.chmodSync(directory, mode);
      }
      await click("Cancel");
      await click(notes ? "Todo" : "Notes");
      const otherAction = notes ? "Add task" : "Add note";
      await expectScreen((text) => text.includes(otherAction), "Navigation must remain usable after the failed write");
      observed.applicationUsable = (await screen()).includes(otherAction);
      await click(notes ? "Notes" : "Todo");
      break;
    }
    default:
      throw new Error(`Unsupported list adapter journey: ${input.caseId}`);
  }
  await app.screenshot({ name: "outcome" });
  await stop();
  await app.type("exit");
  await app.press("ENTER");
  return { observed, exitCode: await app.waitForExit() };
}

async function runBabelAdapter(context, input) {
  const { app, screen, click, expectScreen } = context;
  const config = JSON.parse(fs.readFileSync(path.join(context.externalDirectory, "config.json"), "utf8"));
  const observed = {};
  const readLog = (file) =>
    fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  const provider = ({ response, status = 200 }) =>
    fs.writeFileSync(config.tuiProviderPath, JSON.stringify({ kind: "translation", response, status }), {
      mode: 0o600
    });
  const fill = async (text) => {
    await click("Text to translate (", { rowOffset: 1 });
    await app.press("CTRL_A");
    await app.press("BACKSPACE");
    if (text.length > 0) {
      await app.type(text);
    }
  };
  const translation = (text) => {
    const lines = text.split("\n");
    const start = lines.findIndex((line) => line.trim() === "Translation");
    const end = lines.findIndex((line) => line.trim() === "Dictionary");
    assert.ok(start >= 0 && end > start, "The translation must be observed in the real result area");
    return lines
      .slice(start + 1, end)
      .map((line) => line.trim())
      .join("\n")
      .trim();
  };
  const editorText = (text) => {
    const lines = text.split("\n");
    const first = lines.findIndex((line) => line.includes("Text to translate ("));
    const last = lines.findIndex((line) => line.includes("Language codes:"));
    assert.ok(first >= 0 && last > first);
    return lines
      .slice(first + 1, last)
      .map((line) => line.trim())
      .join("\n")
      .trimEnd();
  };
  const paste = async () => {
    await fill("");
    const cleared = await screen();
    await app.screenshot({ name: "paste-target-cleared" });
    assert.equal(editorText(cleared), "", "The real editor must be empty before testing session paste");
    await app.press("CTRL_V");
    await app.press("END");
    const marker = "|done|";
    await app.type(marker);
    const pasted = await expectScreen(
      (text) => editorText(text).endsWith(marker),
      "The editor must process the paste and subsequent typing before its contents are observed"
    );
    await app.screenshot({ name: "session-pasted" });
    return editorText(pasted).slice(0, -marker.length);
  };
  await expectScreen((text) => text.includes("Add task"), "The real workspace must start");
  await app.press("CTRL_6");
  await click("Text to translate (", { rowOffset: 1 });
  for (const language of ["en", "es"]) {
    await app.press("TAB");
    await app.press("CTRL_A");
    await app.press("BACKSPACE");
    await app.type(language);
  }
  await app.screenshot({ name: "condition" });
  switch (input.caseId) {
    case "babel-invalid-text": {
      const rejected = [];
      for (const [label, value, pattern] of [
        ["whitespace", "   ", /text.*required/i],
        ["5001-characters", "x".repeat(5001), /5000.*fewer/i]
      ]) {
        await fill(value);
        await click("Translate", { area: "actions" });
        await expectScreen(
          (text) => pattern.test(text),
          `The ${label} input must be rejected before any provider request`
        );
        rejected.push(label);
        await app.screenshot({ name: `rejected-${label}` });
      }
      observed.rejectedInputs = rejected;
      observed.providerRequests = readLog(config.requestsPath).length;
      observed.clipboardWrites = readLog(config.clipboardWritesPath).length;
      assert.equal(await paste(), "", "Rejected translation inputs must not overwrite the session clipboard");
      await fill("Still usable");
      observed.applicationUsable = (
        await expectScreen((text) => text.includes("Still usable"), "The editor must remain usable after rejection")
      ).includes("Still usable");
      break;
    }
    case "babel-safe-failures": {
      const rejected = [];
      let allFailures = "";
      for (const [index, response] of input.fixture.translationSequence.entries()) {
        provider({ response, status: index === 0 ? 503 : 200 });
        await fill("hello");
        await click("Translate", { area: "actions" });
        const failure = await expectScreen(
          (text) => (index === 0 ? /could not translate/i : /no translation/i).test(text),
          "The default provider failure must remain safe and recoverable"
        );
        rejected.push(index === 0 ? "provider-failure" : "missing-translation");
        allFailures += failure;
        observed.translation = translation(failure);
        await app.screenshot({ name: `failure-${index + 1}` });
      }
      observed.rejectedResponses = rejected;
      observed.leakedPrivateDetails = /synthetic-private-provider-detail|node:|at create|stack/i.test(allFailures);
      await fill("Edited after failure");
      observed.applicationUsable = (
        await expectScreen((text) => text.includes("Edited after failure"), "The same editor must remain usable")
      ).includes("Edited after failure");
      break;
    }
    case "babel-http-failure": {
      provider({ response: input.fixture.translationHttp.body, status: input.fixture.translationHttp.status });
      await fill("hello");
      await click("Translate", { area: "actions" });
      const failure = await expectScreen(
        (text) => /could not translate/i.test(text),
        "HTTP failure must be visible without terminating the workspace"
      );
      observed.httpStatuses = readLog(config.requestsPath).map((request) => request.status);
      observed.rejectedResponses = /could not translate/i.test(failure) ? ["http-failure"] : [];
      observed.renderedRejectedTranslation = input.fixture.translationHttp.body.sentences.some((sentence) =>
        failure.includes(sentence.trans)
      );
      await app.screenshot({ name: "http-rejected" });
      await app.press("CTRL_1");
      observed.applicationUsable = (
        await expectScreen((text) => text.includes("Add task"), "Navigation must work after HTTP rejection")
      ).includes("Add task");
      break;
    }
    case "babel-dictionary":
    case "babel-without-system-clipboard":
    case "babel-explicit-session-copy": {
      provider({ response: input.fixture.translation });
      await fill(input.caseId === "babel-without-system-clipboard" ? "hello" : "hello world");
      await click("Translate", { area: "actions" });
      const result = await expectScreen(
        (text) => translation(text).length > 0 && !text.includes("Translation in progress"),
        "The real provider result must appear"
      );
      observed.translation = translation(result);
      const dictionary = result
        .split("\n")
        .slice(result.split("\n").findIndex((line) => line.trim() === "Dictionary") + 1)
        .filter((line) => line.includes(" — "));
      observed.dictionaryWords = dictionary.flatMap((line) => line.trim().split(/\s+—\s+|,\s*/));
      const request = readLog(config.requestsPath).findLast((item) => item.service === "googleTranslate");
      assert.ok(request);
      const parameters = new URL(request.url).searchParams;
      observed.requestedLanguages = {
        text: parameters.get("q"),
        source: parameters.get("sl"),
        target: parameters.get("tl")
      };
      observed.clipboardWrites = readLog(config.clipboardWritesPath).length;
      observed.automaticClipboardWrites = observed.clipboardWrites;
      await app.screenshot({ name: "translated" });
      if (input.caseId === "babel-explicit-session-copy") {
        await click("Copy result");
        await expectScreen((text) => text.includes("Copied."), "The explicit copy action must finish before paste");
        await app.screenshot({ name: "copy-confirmed" });
        observed.pastedText = await paste();
      } else {
        assert.equal(await paste(), "", "Successful translation must not copy automatically");
      }
      observed.systemClipboardRequests = readLog(config.clipboardRequestsPath).length;
      observed.systemClipboardWrites = readLog(config.clipboardWritesPath).length;
      await fill("Edited after translation");
      observed.applicationUsable = (
        await expectScreen(
          (text) => text.includes("Edited after translation"),
          "The translated editor must remain usable"
        )
      ).includes("Edited after translation");
      break;
    }
    default:
      throw new Error(`Unsupported Babel adapter journey: ${input.caseId}`);
  }
  await app.screenshot({ name: "outcome" });
  await app.press("CTRL_1");
  await expectScreen((text) => text.includes("Add task"), "The workspace must navigate normally before exit");
  await app.press("CTRL_C");
  const exitCode = await app.waitForExit();
  assert.equal(exitCode, 0);
  return { exitCode, observed };
}

async function runTtsAdapter(context, input) {
  const { app, screen, click, expectScreen } = context;
  const home = assertRepoTempHome(context.home);
  const workspace = path.dirname(path.dirname(home));
  const config = JSON.parse(fs.readFileSync(path.join(context.externalDirectory, "config.json"), "utf8"));
  const output = path.join(home, "out.mp3");
  const voiceFile = path.join(home, ".ilu", ".config", "tts-config.json");
  const observed = {};
  const quote = (value) => `'${String(value).replace(/'/g, `'"'"'`)}'`;
  const requests = () =>
    fs
      .readFileSync(config.requestsPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  let launches = 0;
  let status = null;
  const start = async () => {
    const script = path.join(workspace, `speech-ui-${++launches}.sh`);
    status = path.join(workspace, `speech-ui-${launches}.status`);
    fs.writeFileSync(
      script,
      `printf '\\033[2J\\033[H'\nnode ${quote(path.resolve(import.meta.dirname, "..", "..", "bin", "cli.js"))} ui\nprintf '%s' "$?" > ${quote(status)}\n`,
      { flag: "wx", mode: 0o600 }
    );
    await app.type(`. ${quote(script)}`);
    await app.press("ENTER");
    const startupDeadline = Date.now() + 30000;
    while (!(await screen()).includes("Add task")) {
      assert.ok(Date.now() < startupDeadline, "The instrumented Node workspace must reach its first frame");
      await delay(25);
    }
    await app.press("CTRL_7");
    await expectScreen(
      (text) => text.includes("Input file") && text.includes("Start conversion"),
      "The Speech workspace must open"
    );
  };
  const stop = async () => {
    await app.press("CTRL_1");
    await expectScreen((text) => text.includes("Add task"), "The workspace must navigate before normal exit");
    await app.press("CTRL_C");
    const deadline = Date.now() + 8000;
    while (!fs.existsSync(status)) {
      assert.ok(Date.now() < deadline, "The real Speech workspace must close normally");
      await delay(25);
    }
    assert.equal(fs.readFileSync(status, "utf8"), "0");
  };
  const fill = async ({ label, value }) => {
    await click(label, { rowOffset: 1, exact: true });
    await app.press("CTRL_A");
    await app.press("BACKSPACE");
    if (value.length > 0) {
      await app.type(value);
    }
  };
  const chooseNova = async () => {
    await click("Choose voice");
    const choices = await expectScreen(
      (text) => text.includes("nova") && text.includes("Cancel"),
      "The real supported voice selector must open"
    );
    observed.unsupportedVoiceSelectable = choices.includes("badvoice");
    await click("nova", { area: "overlay" });
    await expectScreen(
      (text) => text.includes("Voice saved.") && !text.includes("Cancel"),
      "The selected supported voice must be persisted"
    );
  };
  await app.type("stty -echo; PS1=''");
  await app.press("ENTER");
  await start();
  await app.screenshot({ name: "condition" });
  switch (input.caseId) {
    case "tts-missing-credentials": {
      await fill({ label: "Input file", value: "input.txt" });
      await fill({ label: "Output file", value: "out.mp3" });
      await click("Start conversion");
      const failure = await expectScreen(
        (text) => /set up text to speech/i.test(text),
        "Missing credentials must stop conversion before the external SDK"
      );
      observed.conversionRejected = /set up text to speech/i.test(failure);
      observed.providerRequests = requests().length;
      const trace = fs.readFileSync(context.execTracePath, "utf8");
      assert.match(
        trace,
        /execve\("[^"]*\/node", \["node",.*"ui"\].*\)\s*=\s*0/,
        "Encoder absence requires an active trace of the actual Node UI process"
      );
      observed.audioEncoderInvocations = trace
        .split("\n")
        .filter((line) => /execve\("[^"]*\/ffmpeg"/.test(line) && /\)\s*=\s*0\s*$/.test(line)).length;
      observed.outputAudioExists = fs.existsSync(output);
      await app.screenshot({ name: "credentials-rejected" });
      await app.press("CTRL_2");
      observed.applicationUsable = (
        await expectScreen(
          (text) => text.includes("Add note"),
          "The workspace must remain usable after missing credentials"
        )
      ).includes("Add note");
      break;
    }
    case "tts-invalid-conversion-input": {
      const rejected = [];
      for (const [label, file, destination, pattern] of [
        ["unsupported-extension", "input.pdf", "out.mp3", /\.txt.*\.md/i],
        ["missing-file", "missing.txt", "out.mp3", /\.txt.*\.md/i],
        ["blank-output", "input.md", "   ", /output.*required/i]
      ]) {
        await fill({ label: "Input file", value: file });
        await fill({ label: "Output file", value: destination });
        await click("Start conversion");
        await expectScreen((text) => pattern.test(text), `The ${label} input must be rejected before conversion`);
        rejected.push(label);
        await app.screenshot({ name: `rejected-${label}` });
      }
      observed.rejectedInputs = rejected;
      observed.providerRequests = requests().length;
      observed.outputAudioExists = fs.existsSync(output);
      await chooseNova();
      observed.applicationUsable = (
        await expectScreen(
          (text) => text.includes("Start conversion") && text.includes("nova"),
          "Supported voice choice must remain usable after invalid inputs"
        )
      ).includes("nova");
      break;
    }
    case "tts-real-conversion-progress": {
      await chooseNova();
      fs.writeFileSync(
        config.tuiProviderPath,
        JSON.stringify({ kind: "speech", response: { deferred: "adapter-audio" } })
      );
      await fill({ label: "Input file", value: "ready.txt" });
      await fill({ label: "Output file", value: "out.mp3" });
      await click("Start conversion");
      const progress = await expectScreen(
        (text) => text.includes("Audio in progress"),
        "Audio progress must be visible before the HTTP response is released"
      );
      observed.progressVisibleBeforeCompletion = progress.includes("Audio in progress") && !fs.existsSync(output);
      await app.screenshot({ name: "audio-pending" });
      fs.writeFileSync(
        path.join(config.releasesDirectory, "adapter-audio.json"),
        JSON.stringify({ syntheticAudio: true }),
        { flag: "wx", mode: 0o600 }
      );
      const success = await expectScreen(
        (text) => text.includes("Audio ready."),
        "The actual SDK and encoder must complete audio creation"
      );
      observed.successVisibleAfterCompletion = success.includes("Audio ready.");
      const request = requests().findLast((request) => request.service === "openai");
      assert.ok(request);
      observed.requestedVoice = request.body.voice;
      observed.requestedText = request.body.input;
      observed.outputAudioExists = fs.existsSync(output);
      const metadata = JSON.parse(
        execFileSync(
          "ffprobe",
          ["-v", "error", "-show_entries", "stream=codec_type:format=duration", "-of", "json", output],
          { encoding: "utf8" }
        )
      );
      observed.generatedAudioDecodable =
        metadata.streams.some((stream) => stream.codec_type === "audio") && Number(metadata.format.duration) > 0;
      await app.screenshot({ name: "audio-ready" });
      await app.press("CTRL_1");
      observed.applicationUsable = (
        await expectScreen((text) => text.includes("Add task"), "Navigation must remain usable after conversion")
      ).includes("Add task");
      break;
    }
    case "tts-safe-failure-and-voice": {
      fs.writeFileSync(config.tuiProviderPath, JSON.stringify({ kind: "speech", response: input.fixture.provider }));
      await fill({ label: "Input file", value: "failure.txt" });
      await fill({ label: "Output file", value: "out.mp3" });
      await click("Start conversion");
      const failure = await expectScreen(
        (text) => /could not create audio/i.test(text),
        "The real external provider failure must use safe copy"
      );
      observed.conversionRejected = /could not create audio/i.test(failure);
      observed.leakedPrivateDetails = /synthetic-private-provider-detail|node:|stack|at create/i.test(failure);
      observed.outputAudioExists = fs.existsSync(output);
      await app.screenshot({ name: "provider-rejected" });
      await chooseNova();
      observed.persistedVoice = JSON.parse(fs.readFileSync(voiceFile, "utf8")).voice;
      await stop();
      await start();
      const restored = await expectScreen(
        (text) => text.includes("nova"),
        "A fresh process must restore the persisted supported voice"
      );
      const lines = restored.split("\n");
      observed.restoredVoice = lines[lines.findIndex((line) => line.trim() === "Voice") + 1].trim();
      break;
    }
    default:
      throw new Error(`Unsupported Speech adapter journey: ${input.caseId}`);
  }
  await app.screenshot({ name: "outcome" });
  await stop();
  await app.type("exit");
  await app.press("ENTER");
  const exitCode = await app.waitForExit();
  assert.equal(exitCode, 0);
  return { exitCode, observed };
}
