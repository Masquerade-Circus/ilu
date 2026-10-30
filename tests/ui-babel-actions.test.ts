import test from "node:test";
import assert from "node:assert/strict";
import { captureIluScenario } from "./test-helpers/terminal-capture.ts";
import { assertCaptureArtifacts } from "./test-helpers/terminal-capture-scenarios.ts";

// adapterBehavior is supplied by the integration owner. It must launch the real
// Node CLI/TUI, drive visible controls and return observations from the live PTY,
// persisted files and external boundaries. Never manufacture these observations
// from this table, call adapters directly or replace internal model methods.
const cases = [
  {
    name: "Babel UI adapter rejects empty and too-long text without provider or clipboard calls",
    caseId: "babel-invalid-text",
    fixture: { translation: "deny-unexpected-network", clipboard: "isolated" },
    journey: ["Open Translate", "Submit whitespace", "Submit 5001 characters", "Keep the form usable"],
    expected: { rejectedInputs: ["whitespace", "5001-characters"], providerRequests: 0, clipboardWrites: 0, applicationUsable: true }
  },
  {
    name: "Babel UI adapter returns translation and dictionary without copying automatically",
    caseId: "babel-dictionary",
    fixture: { translation: { sentences: [{ trans: "Hola mundo", orig: "hello world" }], dict: [{ entry: [{ word: "Hola", reverse_translation: ["Hello", "Hi"] }] }], src: "en" }, clipboard: "isolated" },
    journey: ["Open Translate", "Translate hello world from en to es", "Inspect translation and dictionary before explicit copy"],
    expected: { translation: "Hola mundo", dictionaryWords: ["Hola", "Hello", "Hi"], requestedLanguages: { text: "hello world", source: "en", target: "es" }, clipboardWrites: 0 }
  },
  {
    name: "Babel UI actions do not load a process clipboard adapter",
    caseId: "babel-without-system-clipboard",
    fixture: { translation: { sentences: [{ trans: "Hola" }], src: "en" }, systemClipboard: "unavailable" },
    journey: ["Open Translate in a host without a system clipboard service", "Translate hello from en to es", "Edit the input after success"],
    expected: { translation: "Hola", systemClipboardRequests: 0, applicationUsable: true }
  },
  {
    name: "Babel UI adapter does not copy through an Ilu clipboard adapter",
    caseId: "babel-explicit-session-copy",
    fixture: { translation: { sentences: [{ trans: "Hola mundo" }], src: "en" }, systemClipboard: "unavailable", clipboard: "isolated" },
    journey: ["Translate hello world", "Verify no automatic copy", "Activate Copy result", "Paste into the real Translate editor"],
    // Valyrian may probe unavailable system commands. Session paste must still
    // succeed without any successful external clipboard write.
    expected: { automaticClipboardWrites: 0, pastedText: "Hola mundo", systemClipboardWrites: 0 }
  },
  {
    name: "Babel UI adapter redacts provider failures and missing translations",
    caseId: "babel-safe-failures",
    fixture: { translationSequence: [{ error: "synthetic-private-provider-detail" }, { sentences: [], src: "en" }], network: "intercept-only" },
    journey: ["Translate hello and observe provider failure", "Retry and observe missing translation", "Edit the form after both failures"],
    expected: { rejectedResponses: ["provider-failure", "missing-translation"], leakedPrivateDetails: false, translation: "", applicationUsable: true }
  },
  {
    name: "Babel UI adapter converts default provider HTTP failures without exiting the process",
    caseId: "babel-http-failure",
    fixture: { translationHttp: { status: 500, body: { sentences: [{ trans: "Must not appear" }], src: "en" } }, network: "intercept-only" },
    journey: ["Translate hello through the default HTTP provider", "Observe failure", "Navigate to Todo without restarting"],
    expected: { httpStatuses: [500], rejectedResponses: ["http-failure"], renderedRejectedTranslation: false, applicationUsable: true }
  }
];

for (const entry of cases) {
  test(entry.name, async context => {
    const result = await captureIluScenario({ testName: context.name, scenario: "adapterBehavior", command: ["node", "bin/cli.js", "ui"], input: { area: "babel", caseId: entry.caseId, fixture: entry.fixture, journey: entry.journey }, viewport: { cols: 100, rows: 40 } });
    assert.equal(result.exitCode, 0);
    for (const [key, expected] of Object.entries(entry.expected)) {
      assert.deepEqual(result.observed[key], expected, `${entry.caseId}: ${key}`);
    }
    assertCaptureArtifacts({ result, testName: context.name, checkpoints: ["condition", "outcome"], diagnostic: message => context.diagnostic(message) });
  });
}
