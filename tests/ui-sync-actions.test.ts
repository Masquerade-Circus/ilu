import test from "node:test";
import assert from "node:assert/strict";
import { captureIluScenario } from "./test-helpers/terminal-capture.ts";
import { assertCaptureArtifacts } from "./test-helpers/terminal-capture-scenarios.ts";

const cases = [
  {
    name: "Sync UI adapter maps detailed statuses to approved safe labels",
    caseId: "sync-statuses",
    fixture: "local-remotes-status-matrix",
    journey: ["With separate local-only fixture states open Sync for healthy, healthy with pending work, pending_remote, disabled, misconfigured and degraded_network", "Inspect each status meaning without asserting exact copy"],
    expected: { visibleStatusMeanings: ["synced", "pending", "pending", "off", "not-configured", "failed"], rawInternalStatusLeaked: false }
  },
  {
    name: "Sync UI adapter redacts unsafe command failures",
    caseId: "sync-safe-status-failure",
    fixture: "local-transport-failure-with-synthetic-private-detail",
    journey: ["Open Sync with a failing local transport", "Refresh status and observe a recoverable failure", "Inspect visible screen and details for private path and token leakage"],
    expected: { visibleStatusMeanings: ["failed"], leakedPrivateDetails: false, localDomainFilesUnchanged: true, applicationUsable: true }
  },
  {
    name: "Sync retry, enable, and disable call command functions only after explicit action",
    caseId: "sync-explicit-controls",
    fixture: "configured-disabled-local-remote",
    journey: ["Open Sync and inspect initially disabled persisted config and remote refs", "Verify no enable, disable or retry mutation from merely viewing", "Click Retry sync", "Click Enable sync", "Click Disable sync", "Restart"],
    expected: { viewingChangedEnabledSetting: false, viewingChangedRemoteRefs: false, explicitOperationOrder: ["retry", "enable", "disable"], enabledAfterEnable: true, enabledAfterDisable: false, restoredEnabled: false }
  },
  {
    name: "Sync init rejects missing remote URL, branch, and confirmation without command calls",
    caseId: "sync-required-setup",
    fixture: "unconfigured-with-local-remote",
    journey: ["Open setup and submit without remote URL", "Enter local fixture remote and clear branch, then submit", "Enter main without confirmation and submit", "Inspect config, remote refs and local files after each rejection"],
    expected: { rejectedInputs: ["missing-remote", "missing-branch", "unconfirmed"], syncConfigCreated: false, remoteRefsUnchanged: true, localDomainFilesUnchanged: true }
  },
  {
    name: "Sync init rejects any embedded URL userinfo before command calls",
    caseId: "sync-userinfo-rejection",
    fixture: "unconfigured-deny-all-network",
    journey: ["Submit each synthetic URL with main and explicit confirmation", "Check validation before any transport attempt"],
    remoteUrls: ["https://user:password@example.test/repo.git", "https://token@example.test/repo.git", "https://ghp_TOKEN@example.test/repo.git", "ssh://git:token@example.test/repo.git"],
    expected: { rejectedRemoteCount: 4, transportRequests: 0, syncConfigCreated: false, localDomainFilesUnchanged: true }
  },
  {
    name: "Sync init action allows SSH remotes with a normal user",
    caseId: "sync-normal-ssh-user",
    fixture: "local-git-remote-with-intercepted-ssh-transport",
    journey: ["Set up ssh://git@example.test/repo.git with main and confirmation", "External SSH transport must map exclusively to the owned local bare repo", "Inspect configured remote and refreshed visible status"],
    expected: { setupAccepted: true, configuredRemoteUrl: "ssh://git@example.test/repo.git", configuredBranch: "main", realNetworkConnections: 0, statusRefreshedAfterSetup: true }
  },
  {
    name: "Sync init preserves command safety path and refreshes status after setup",
    caseId: "sync-init-refresh-pending",
    fixture: "local-empty-remote-then-temporarily-unavailable-transport",
    journey: ["Set up owned empty local remote with main and confirmation", "Make only the local remote transport temporarily unavailable after local setup", "Create local pending work", "Refresh Sync and inspect pending state with persisted local work"],
    expected: { setupAccepted: true, configuredBranch: "main", pendingWorkVisible: true, pendingWorkPersisted: true, localWorkPreserved: true, statusRefreshedAfterSetup: true }
  },
  {
    name: "Sync UI adapter classifies setup and init safety stops without leaking internals",
    caseId: "sync-setup-safety-stops",
    fixture: "missing-enabled-remote-and-both-sides-populated",
    journey: ["Open Sync with enabled config missing remoteUrl and inspect setup-required state", "In a separate private HOME attempt confirmed init with both local and owned local remote already populated", "Inspect safety stop and compare both histories and domain files"],
    expected: { missingRemoteRequiresSetup: true, conflictingInitRejected: true, localDomainFilesUnchanged: true, remoteRefsUnchanged: true, leakedPrivateDetails: false }
  }
];

for (const entry of cases) {
  test(entry.name, async context => {
    const result = await captureIluScenario({ testName: context.name, scenario: "adapterBehavior", command: ["node", "bin/cli.js", "ui"], input: { area: "sync", caseId: entry.caseId, fixture: entry.fixture, journey: entry.journey, remoteUrls: "remoteUrls" in entry ? entry.remoteUrls : [] }, viewport: { cols: 100, rows: 40 } });
    assert.equal(result.exitCode, 0);
    for (const [key, expected] of Object.entries(entry.expected)) {
      assert.deepEqual(result.observed[key], expected, `${entry.caseId}: ${key}`);
    }
    assertCaptureArtifacts({ result, testName: context.name, checkpoints: ["condition", "outcome"], diagnostic: message => context.diagnostic(message) });
  });
}
