import fs from 'node:fs';
import path from 'node:path';
import {launchTerminal} from '@valyrianjs/terminal/testing';
import {captureScenarios} from './terminal-capture-scenarios.ts';
import {createCaptureScreenReader} from './terminal-capture-screen.ts';

const [requestPath, responsePath] = process.argv.slice(2);
const request = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
const outputDir = path.dirname(requestPath);
let app = null;
let failure = null;
let outcome = null;
let artifacts = null;
let directory = null;
try {
  app = await launchTerminal({
    command: request.command,
    cwd: path.resolve(import.meta.dirname, '..', '..'),
    outputDir,
    viewport: request.viewport,
    video: 'off',
    timeoutMs: 8000
  });
  const runs = fs.readdirSync(outputDir).filter(name => name.startsWith('run-'));
  if (runs.length !== 1) {
    throw new Error('Expected one capture-owned run directory');
  }
  directory = path.join(outputDir, runs[0]);
  const outputPath = path.join(directory, 'terminal-output.bin');
  const reader = createCaptureScreenReader({directory});
  const screen = async () => {
    const deadline = Date.now() + 8000;
    let previous = -1;
    while (Date.now() < deadline) {
      const length = fs.statSync(outputPath).size;
      await Bun.sleep(30);
      if (length === previous && length === fs.statSync(outputPath).size) {
        return reader.read();
      }
      previous = length;
    }
    throw new Error('The captured PTY did not settle for a screen observation');
  };
  const interactions = {
    ...app,
    async resize(size) {
      const before = fs.statSync(outputPath).size;
      const status = JSON.parse(fs.readFileSync(path.join(directory, 'application.json'), 'utf8'));
      reader.resize(size);
      await app.resize(size);
      if (status.cols !== size.cols || status.rows !== size.rows) {
        const deadline = Date.now() + 8000;
        while (fs.statSync(outputPath).size === before) {
          if (Date.now() >= deadline) {
            throw new Error('The application did not redraw after the physical TTY resize');
          }
          await Bun.sleep(20);
        }
      }
      await screen();
    }
  };
  if (!Object.hasOwn(captureScenarios, request.scenario)) {
    throw new Error('Unknown capture scenario');
  }
  outcome = await captureScenarios[request.scenario]({
    app: interactions,
    home: path.join(directory, 'home'),
    screen
  }, request.input);
} catch (error) {
  failure = error;
  if (app !== null) {
    try {
      await app.screenshot({name: 'scenario-failure'});
    } catch (captureError) {
      failure = new AggregateError([error, captureError], 'Scenario and failure screenshot failed');
    }
  }
} finally {
  if (app !== null) {
    try {
      artifacts = await app.close();
    } catch (error) {
      failure = failure === null ? error : new AggregateError([failure, error], 'Scenario and capture cleanup failed');
    }
  }
}
const result = failure === null
  ? {ok: true, value: {...outcome, ...artifacts, outputPath: path.join(artifacts.directory, 'terminal-output.bin')}}
  : {ok: false, error: failure instanceof Error ? `${failure.stack}\n${failure instanceof AggregateError ? failure.errors.map(String).join('\n') : ''}` : String(failure)};
fs.writeFileSync(responsePath, JSON.stringify(result, null, 2), {mode: 0o600});
process.exitCode = failure === null ? 0 : 1;
