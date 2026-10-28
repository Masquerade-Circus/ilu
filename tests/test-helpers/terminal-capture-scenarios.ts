import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import IluDb from 'iludb';
import JsonPlugin from 'iludb/plugins/node-json';
import {assertRepoTempHome} from '../../support/home-sandbox.ts';

IluDb.use(JsonPlugin);
const root = path.resolve(import.meta.dirname, '..', '..');
export const captureCommand = ['node', '--import', 'tsx', '--import', path.join(import.meta.dirname, 'terminal-capture-home.ts'), path.join(root, 'bin', 'cli.js'), 'ui'];

// The implementation owner supplies the Node/Bun bridge, lifecycle and live PTY screen reader.
// screen() must describe the CURRENT real application's terminal, never a headless rerender
// or a search in accumulated output. These fixtures only interact and assert CLI/TUI behavior.
async function expectScreen({screen, predicate, message}) {
  const deadline = Date.now() + 8000;
  let current = '';
  do {
    current = await screen();
    if (predicate(current)) {
      return current;
    }
    await delay(25);
  } while (Date.now() < deadline);
  assert.fail(`${message}\nCurrent terminal:\n${current}`);
}

async function clickText({app, screen, text, rowOffset = 0, occurrence = 0}) {
  const current = await expectScreen({screen, predicate: value => value.includes(text), message: `Expected visible target ${text}`});
  const lines = current.split('\n');
  const matches = lines.flatMap((line, row) => line.includes(text) ? [{column: line.indexOf(text) + 1, row: row + 1 + rowOffset}] : []);
  assert.ok(matches[occurrence], `Expected target occurrence ${occurrence}: ${text}`);
  await app.mouse({action: 'press', ...matches[occurrence]});
  await app.mouse({action: 'release', ...matches[occurrence]});
}

function readLists({home, domain}) {
  const safeHome = assertRepoTempHome(home, 'Captured application HOME');
  return IluDb(path.join(safeHome, '.ilu', `${domain}.json`)).getCollection(domain).find();
}

async function finish({app, screen}) {
  await clickText({app, screen, text: 'Todo'});
  await app.press('CTRL_C');
  const exitCode = await app.waitForExit();
  assert.equal(exitCode, 0, 'the captured real CLI must exit normally');
  return {exitCode};
}

async function openItemEditor({app, screen, domain}) {
  await clickText({app, screen, text: domain});
  await clickText({app, screen, text: domain === 'Todo' ? 'Capture task' : 'Capture note'});
  await app.press(domain === 'Todo' ? 'o' : 'ENTER');
  await clickText({app, screen, text: domain === 'Todo' ? 'Edit task' : 'Edit note'});
  await expectScreen({screen, predicate: text => text.includes('Cancel') && text.includes('Save'), message: 'The edit dialog must be open'});
}

export const captureScenarios = {
  async notesFocus(context) {
    const {app, screen} = context;
    const home = assertRepoTempHome(context.home, 'Captured Notes HOME');
    await clickText({app, screen, text: 'Notes'});
    await expectScreen({screen, predicate: text => text.includes('Capture note'), message: 'Notes must display its active list'});
    await app.screenshot({name: 'notes-list'});
    await clickText({app, screen, text: 'Archive Notes'});
    await expectScreen({screen, predicate: text => text.includes('Archived note') && !text.includes('Capture note'), message: 'Switching lists must replace visible notes'});
    await app.screenshot({name: 'notes-selector-focus'});
    await clickText({app, screen, text: 'Capture Notes'});
    await clickText({app, screen, text: 'Capture note'});
    await app.screenshot({name: 'notes-list-focus'});
    await clickText({app, screen, text: 'Manage lists'});
    await expectScreen({screen, predicate: text => text.includes('Rename list') && text.includes('Archive Notes'), message: 'List management must remain usable'});
    await app.screenshot({name: 'notes-manager'});
    await app.press('ESCAPE');
    const before = fs.readFileSync(path.join(home, '.ilu', 'notes.json'), 'utf8');
    await clickText({app, screen, text: 'Add note'});
    await app.type('Unsaved capture note');
    await clickText({app, screen, text: 'Note content', rowOffset: 1});
    await app.type('Synthetic draft');
    await expectScreen({screen, predicate: text => text.includes('Synthetic draft') && text.includes('Cancel'), message: 'The note editor must accept text'});
    await app.screenshot({name: 'notes-editor-focus'});
    await clickText({app, screen, text: 'Cancel'});
    assert.equal(fs.readFileSync(path.join(home, '.ilu', 'notes.json'), 'utf8'), before, 'cancel must discard the note draft');
    return finish(context);
  },

  async listEditor(context, {domain}) {
    const {app, screen} = context;
    const home = assertRepoTempHome(context.home, 'Captured editor HOME');
    assert.ok(domain === 'Todo' || domain === 'Notes');
    const db = domain === 'Todo' ? 'todos' : 'notes';
    await openItemEditor({...context, domain});
    const before = fs.readFileSync(path.join(home, '.ilu', `${db}.json`), 'utf8');
    const visibleCounts = [];
    for (const size of [{cols: 80, rows: 24}, {cols: 100, rows: 40}, {cols: 80, rows: 24}]) {
      await app.resize(size);
      const frame = await expectScreen({screen, predicate: text => text.includes('Save') && text.includes('Cancel') && /Row\d{2}/.test(text) && text.split('\n').length <= size.rows, message: 'Resize must keep editor content and actions visible'});
      assert.ok(frame.split('\n').every(line => line.length <= size.cols));
      visibleCounts.push((frame.match(/Row\d{2}/g) ?? []).length);
      await app.screenshot({name: `editor-${visibleCounts.length}`});
    }
    assert.ok(visibleCounts[1] > visibleCounts[0], 'a taller editor must expose more real document lines');
    assert.equal(visibleCounts[2], visibleCounts[0]);
    await clickText({app, screen, text: 'Cancel'});
    assert.equal(fs.readFileSync(path.join(home, '.ilu', `${db}.json`), 'utf8'), before);
    await openItemEditor({...context, domain});
    await clickText({app, screen, text: domain === 'Todo' ? 'Task details' : 'Note content', rowOffset: 1});
    for (let row = 0; row < 44; row++) {
      await app.press('UP');
    }
    await app.press('HOME');
    await app.type('Edited capture ');
    await expectScreen({screen, predicate: text => text.includes('Edited capture ') && text.includes('Save') && text.includes('Cancel'), message: 'Editing must preserve the document and its visible Save/Cancel controls'});
    await app.screenshot({name: 'editor-edited'});
    await clickText({app, screen, text: 'Save'});
    await expectScreen({screen, predicate: text => !text.includes('Cancel'), message: 'Save must close the dialog'});
    const lists = readLists({home, domain: db});
    const saved = lists.flatMap(list => list[domain === 'Todo' ? 'tasks' : 'notes']).find(item => item.title === (domain === 'Todo' ? 'Capture task' : 'Capture note'));
    assert.ok(saved);
    const expected = `Edited capture ${Array.from({length: 44}, (_, index) => `Row${String(index + 1).padStart(2, '0')}`).join('\n')}`;
    assert.equal(domain === 'Todo' ? saved.description : saved.content, expected);
    await app.screenshot({name: 'editor-saved'});
    return finish(context);
  },

  async boardLayout(context) {
    const {app, screen} = context;
    const home = assertRepoTempHome(context.home, 'Captured Board HOME');
    await clickText({app, screen, text: 'Board'});
    const before = fs.readFileSync(path.join(home, '.ilu', 'boards.json'), 'utf8');
    const initial = await expectScreen({screen, predicate: text => text.includes('Long') && text.includes('Other'), message: 'Both Board columns must be visible'});
    const start = frame => frame.split('\n').find(line => line.includes('Long') && line.includes('Other'))?.indexOf('Other') ?? -1;
    await app.screenshot({name: 'board-before'});
    await clickText({app, screen, text: 'Long'});
    await app.press('CTRL_K');
    const help = await expectScreen({screen, predicate: text => /layout|resiz/i.test(text), message: 'Board Help must expose its resize action'});
    const hint = help.split('\n').find(line => /layout|resiz|adjust.*column/i.test(line) && /Ctrl\+/i.test(line));
    const key = hint?.match(/\b(Ctrl\+[A-Z0-9]+)\b/i)?.[1];
    assert.ok(key, 'a documented keyboard resize action must be available');
    await app.press('ESCAPE');
    await clickText({app, screen, text: 'Backlog'});
    await app.press(key.replace('+', '_').toUpperCase());
    await app.screenshot({name: 'board-layout-mode'});
    await app.press('SHIFT_RIGHT');
    await app.press('ESCAPE');
    const keyboard = await expectScreen({screen, predicate: text => start(text) > start(initial), message: 'Columns must reflect keyboard resizing'});
    assert.ok(start(keyboard) > start(initial), 'keyboard adjustment must move the real column boundary');
    await app.screenshot({name: 'board-keyboard'});
    const lines = keyboard.split('\n');
    const row = lines.findIndex(line => line.includes('Long') && line.includes('Other'));
    const column = lines[row].lastIndexOf('│', lines[row].indexOf('Other'));
    assert.ok(column > 0);
    await app.mouse({action: 'press', column, row: row + 1});
    await app.mouse({action: 'drag', column: column + 3, row: row + 1});
    await app.mouse({action: 'release', column: column + 3, row: row + 1});
    const dragged = await expectScreen({screen, predicate: text => text.includes('Long') && text.includes('Other') && start(text) > start(keyboard), message: 'Dragging the divider must resize the real Board'});
    const headerStart = frame => frame.split('\n').find(line => line.includes('Ready') && line.includes('(1)')).indexOf('Ready');
    assert.equal(headerStart(dragged) - headerStart(keyboard), start(dragged) - start(keyboard));
    await app.screenshot({name: 'board-dragged'});
    await app.resize({cols: 100, rows: 40});
    await expectScreen({screen, predicate: text => text.includes('Other') && text.includes('Add card'), message: 'Resized Board must preserve content and actions'});
    await app.screenshot({name: 'board-resized'});
    assert.equal(fs.readFileSync(path.join(home, '.ilu', 'boards.json'), 'utf8'), before, 'layout adjustment must not move cards or persist sizes');
    return finish(context);
  },

  async translateEditor(context) {
    const {app, screen} = context;
    await openItemEditor({...context, domain: 'Notes'});
    await clickText({app, screen, text: 'Note content', rowOffset: 1});
    await app.press('CTRL_A');
    await app.press('CTRL_C');
    await app.press('ESCAPE');
    await clickText({app, screen, text: 'Translate'});
    await clickText({app, screen, text: 'Text to translate (', rowOffset: 1});
    await app.press('CTRL_V');
    for (const [index, size] of [{cols: 80, rows: 24}, {cols: 100, rows: 40}, {cols: 80, rows: 24}].entries()) {
      await app.resize(size);
      await expectScreen({screen, predicate: text => text.includes('Row43') && text.includes('Row44') && text.includes('From') && text.includes('To') && text.includes('Copy result'), message: 'Translate must preserve multiline text, language fields and actions after resize'});
      await app.screenshot({name: `translate-${index + 1}`});
      // Only inputs and window size change. No translation provider is called.
    }
    return finish(context);
  },

  async helpFooter(context) {
    const {app, screen} = context;
    await clickText({app, screen, text: 'Notes'});
    await clickText({app, screen, text: 'Add note'});
    await app.type('Clipboard capture');
    await app.screenshot({name: 'footer-input'});
    await clickText({app, screen, text: 'Note content', rowOffset: 1});
    await app.type('Copy roundtrip');
    await app.press('CTRL_A');
    await app.press('CTRL_C');
    await app.press('BACKSPACE');
    await app.press('CTRL_V');
    await expectScreen({screen, predicate: text => text.includes('Copy roundtrip') && /Ctrl\+C[^\n]*copy/i.test(text), message: 'Editor copy and paste must work without closing the dialog'});
    await app.screenshot({name: 'footer-editor'});
    await app.press('CTRL_K');
    await expectScreen({screen, predicate: text => text.includes('Notes help'), message: 'Help must cover the editor'});
    await app.screenshot({name: 'help-over-editor'});
    await app.press('ESCAPE');
    await expectScreen({screen, predicate: text => !text.includes('Notes help') && text.includes('Copy roundtrip'), message: 'Esc must close Help and preserve the draft'});
    await app.screenshot({name: 'help-closed'});
    await clickText({app, screen, text: 'Save'});
    await expectScreen({screen, predicate: text => !text.includes('Cancel'), message: 'The draft must remain saveable after Help'});
    const saved = readLists({home: context.home, domain: 'notes'}).flatMap(list => list.notes).find(note => note.title === 'Clipboard capture');
    assert.equal(saved?.content, 'Copy roundtrip');
    return finish(context);
  },

  async cliFailure({app, screen}) {
    const exitCode = await app.waitForExit();
    assert.notEqual(exitCode, 0, 'the real CLI must reject an unsupported option');
    await expectScreen({screen, predicate: text => text.includes('--unsupported-capture-option') && /option|argument/i.test(text), message: 'The CLI must identify the rejected option, not fail to launch'});
    await app.screenshot({name: 'cli-error'});
    return {exitCode};
  }
};

export function assertCaptureArtifacts({result, checkpoints, diagnostic}) {
  const outputRoot = path.join(root, 'tmp', 'terminal-captures');
  const relative = path.relative(outputRoot, result.directory);
  assert.ok(relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative), 'capture artifacts must stay under the repository capture root');
  for (const file of [...checkpoints.map(name => result.screenshots[name]), result.actionsPath, result.outputPath]) {
    assert.equal(typeof file, 'string', 'the capture must expose image and diagnostic paths');
    const location = path.relative(result.directory, file);
    assert.ok(location.length > 0 && !location.startsWith('..') && !path.isAbsolute(location), 'images and diagnostics must belong to this capture');
  }
  for (const name of checkpoints) {
    const png = result.screenshots[name];
    assert.equal(typeof png, 'string', `missing physical PNG checkpoint ${name}`);
    const bytes = fs.readFileSync(png);
    assert.ok(bytes.length > 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `expected PNG bytes for ${name}`);
    assert.ok(bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0, 'PNG must have nonzero image dimensions');
    diagnostic(`${name} (${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)} pixels): ${png}`);
  }
  assert.ok(fs.statSync(result.actionsPath).isFile(), 'capture diagnostics must remain inspectable');
  assert.ok(fs.statSync(result.outputPath).size > 0, 'the real CLI output must remain available for diagnosis');
  diagnostic(`Application output: ${result.outputPath}`);
  diagnostic(`Capture diagnostics: ${result.directory}`);
}
