import test from "node:test";
import assert from "node:assert/strict";
import { captureIluScenario } from "./test-helpers/terminal-capture.ts";
import { assertCaptureArtifacts } from "./test-helpers/terminal-capture-scenarios.ts";

const cases = [
  {
    name: "Clock adapter rejects invalid names timezones and positions before model calls",
    caseId: "clocks-invalid-input",
    fixture: { clocks: [{ name: "UTC", timezone: "Etc/UTC" }] },
    journey: ["Open Clocks", "Try adding a whitespace name", "Search Invalid/Zone and try saving without a valid zone", "Open Remove with no selected clock", "Try moving the only clock in both directions"],
    expected: { invalidClockSaved: false, clocksUnchanged: true, boundaryMovesChangedOrder: false }
  },
  {
    name: "Clock adapter calls clock model APIs with normalized payloads",
    caseId: "clocks-normalized-crud",
    fixture: { clocks: [{ name: "UTC", timezone: "Etc/UTC" }, { name: "Mexico City", timezone: "America/Mexico_City" }, { name: "Tokyo", timezone: "Asia/Tokyo" }] },
    journey: ["Add clock named '  London  ' with Europe/London", "Select Mexico City and Tokyo for removal, toggle Tokyo twice more to keep a single selection", "Confirm removal", "Move London above UTC", "Reopen Clocks after restart"],
    expected: { savedClocks: [{ name: "London", timezone: "Europe/London" }, { name: "UTC", timezone: "Etc/UTC" }], restoredClockNames: ["London", "UTC"] }
  },
  {
    name: "Clock adapter converts thrown model failures into safe copy",
    caseId: "clocks-write-failure",
    fixture: { clocks: [{ name: "UTC", timezone: "Etc/UTC" }], persistence: "make-clock-target-unwritable-after-start" },
    journey: ["Open Clocks", "Add a valid London clock against the blocked file target", "Observe a recoverable error without filesystem details"],
    expected: { saveRejected: true, clocksUnchanged: true, leakedPrivateDetails: false, applicationUsable: true }
  },
  {
    name: "Clock timezone search includes UTC alias fallback without truncating results",
    caseId: "clocks-utc-search",
    fixture: { clocks: [] },
    journey: ["Open Add clock", "Search utc", "Select UTC (Etc/UTC)", "Save clock named UTC", "Reopen its details"],
    expected: { selectedTimezone: "Etc/UTC", savedClocks: [{ name: "UTC", timezone: "Etc/UTC" }], utcSearchResultsTruncated: false }
  }
];

for (const entry of cases) {
  test(entry.name, async context => {
    const result = await captureIluScenario({ testName: context.name, scenario: "adapterBehavior", command: ["node", "bin/cli.js", "ui"], input: { area: "clocks", caseId: entry.caseId, fixture: entry.fixture, journey: entry.journey }, viewport: { cols: 100, rows: 40 } });
    assert.equal(result.exitCode, 0);
    for (const [key, expected] of Object.entries(entry.expected)) {
      assert.deepEqual(result.observed[key], expected, `${entry.caseId}: ${key}`);
    }
    assertCaptureArtifacts({ result, testName: context.name, checkpoints: ["condition", "outcome"], diagnostic: message => context.diagnostic(message) });
  });
}
