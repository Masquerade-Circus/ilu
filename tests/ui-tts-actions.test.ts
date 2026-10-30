import test from "node:test";
import assert from "node:assert/strict";
import { captureIluScenario } from "./test-helpers/terminal-capture.ts";
import { assertCaptureArtifacts } from "./test-helpers/terminal-capture-scenarios.ts";

const cases = [
  {
    name: "TTS UI adapter rejects missing credentials before service, OpenAI, or ffmpeg calls",
    caseId: "tts-missing-credentials",
    fixture: { files: { "input.txt": "Hello from a fixture." }, credentials: "absent", provider: "deny-unexpected-network" },
    journey: ["Open Speech", "Use private input.txt and out.mp3 with alloy", "Activate Create audio", "Inspect setup-required failure and output directory"],
    expected: { conversionRejected: true, providerRequests: 0, audioEncoderInvocations: 0, outputAudioExists: false, applicationUsable: true }
  },
  {
    name: "TTS UI adapter validates input extension, existence, output path, and voice before conversion",
    caseId: "tts-invalid-conversion-input",
    fixture: { files: { "input.md": "Hello from a fixture.", "input.pdf": "Not an accepted input." }, credentials: "synthetic-local-only", provider: "deny-unexpected-network", storedVoice: "badvoice" },
    journey: ["Open Speech and try input.pdf", "Try missing.txt", "Try input.md with whitespace output", "Open voices with unsupported persisted badvoice and verify only supported choices can be committed", "Inspect that all rejected conversions left no audio"],
    expected: { rejectedInputs: ["unsupported-extension", "missing-file", "blank-output"], unsupportedVoiceSelectable: false, providerRequests: 0, outputAudioExists: false, applicationUsable: true }
  },
  {
    name: "TTS UI adapter creates audio through injected service and reports progress safely",
    caseId: "tts-real-conversion-progress",
    fixture: { files: { "ready.txt": "Hello from a fixture." }, credentials: "synthetic-local-only", provider: "intercept-openai-with-valid-audio", responseGate: "hold-until-progress-captured" },
    journey: ["Open Speech with ready.txt, ready.mp3 and nova", "Activate Create audio", "Capture pending progress before releasing the external HTTP response", "Release valid synthetic audio response", "Observe success and inspect resulting audio file"],
    expected: { requestedVoice: "nova", requestedText: "Hello from a fixture.", progressVisibleBeforeCompletion: true, successVisibleAfterCompletion: true, generatedAudioDecodable: true, outputAudioExists: true, applicationUsable: true }
  },
  {
    name: "TTS UI adapter redacts conversion failures and persists supported voices only",
    caseId: "tts-safe-failure-and-voice",
    fixture: { files: { "failure.txt": "Hello from a fixture." }, credentials: "synthetic-local-only", provider: { error: "synthetic-private-provider-detail" }, storedVoice: "badvoice" },
    journey: ["Try converting failure.txt to failure.mp3 with alloy", "Observe safe provider error", "Open voice selector and verify badvoice cannot be selected", "Choose nova", "Restart and reopen Speech"],
    expected: { conversionRejected: true, leakedPrivateDetails: false, outputAudioExists: false, unsupportedVoiceSelectable: false, persistedVoice: "nova", restoredVoice: "nova" }
  }
];

for (const entry of cases) {
  test(entry.name, async context => {
    const result = await captureIluScenario({ testName: context.name, scenario: "adapterBehavior", command: ["node", "bin/cli.js", "ui"], input: { area: "tts", caseId: entry.caseId, fixture: entry.fixture, journey: entry.journey }, viewport: { cols: 100, rows: 40 } });
    assert.equal(result.exitCode, 0);
    for (const [key, expected] of Object.entries(entry.expected)) {
      assert.deepEqual(result.observed[key], expected, `${entry.caseId}: ${key}`);
    }
    assertCaptureArtifacts({ result, testName: context.name, checkpoints: ["condition", "outcome"], diagnostic: message => context.diagnostic(message) });
  });
}
