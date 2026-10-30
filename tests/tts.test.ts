import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawnSync } from "node:child_process";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { createTtsService } from "../tts/index.ts";
import { withTempHome } from "../support/home-sandbox.ts";
import { captureIluScenario } from "./test-helpers/terminal-capture.ts";
import { assertCaptureArtifacts } from "./test-helpers/terminal-capture-scenarios.ts";

const cases = [
  { name: "tts test helper restaura HOME original después del override temporal", kind: "home" },
  {
    name: "tts convierte markdown a audio, pide API key faltante y la guarda en tts-config.json usando alloy por default",
    kind: "missing-key"
  },
  { name: "tts rechaza output que resuelve al mismo archivo de entrada antes de llamar OpenAI", kind: "overwrite" },
  { name: "tts reutiliza API key y voz guardadas en .config/tts-config.json y no pide prompt", kind: "saved-config" },
  { name: "tts usa voz explícita soportada en el contrato real de conversión", kind: "explicit-voice" },
  { name: "tts rechaza voz no soportada antes de crear cliente OpenAI", kind: "invalid-voice" },
  { name: "tts rechaza inputs que no sean .txt o .md", kind: "invalid-extension" },
  {
    name: "tts voice sin argumento usa prompt select compatible, muestra voces soportadas y persiste la elección",
    kind: "choose-voice"
  },
  { name: "tts ignora config anterior y sync-config, cae a alloy y pide API key nueva", kind: "old-config" },
  {
    name: "TTS CLI bounds multilingual requests conservatively and preserves all text with real audio merge",
    kind: "multilingual"
  },
  { name: "tts con texto corto hace un solo request, genera chunk numerado y mergea al final", kind: "short" },
  { name: "tts usa temp dir adyacente y nombres numerados estables para chunks", kind: "chunk-paths" },
  { name: "tts construye concat input de ffmpeg en orden determinista", kind: "concat-order" },
  {
    name: "tts usa rutas absolutas en concat.txt cuando mergea una sola parte con output relativo",
    kind: "relative-output"
  },
  {
    name: "tts con varios párrafos largos hace múltiples requests en orden, mergea después y borra chunks numerados",
    kind: "paragraphs"
  },
  { name: "tts preserva carpeta temporal y chunks si el merge falla", kind: "merge-failure" },
  { name: "tts divide un párrafo demasiado largo por oraciones antes de cortar por longitud", kind: "sentences" },
  { name: "tts usa fallback por longitud cuando una oración todavía excede el límite", kind: "length" },
  {
    name: "tts reintenta con el mismo comando, omite chunks existentes y continúa desde el siguiente faltante",
    kind: "printed-retry"
  },
  ...["text", "voice", "model", "chunk-size", "legacy", "none"].map((change) => ({
    name: `TTS CLI resumes only the same audio job after ${change} change with real merge`,
    kind: "resume",
    change
  }))
];

function audioBytes(tone: number) {
  const result = spawnSync(ffmpegInstaller.path, [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${tone}:duration=0.18`,
    "-f",
    "mp3",
    "pipe:1"
  ]);
  assert.equal(result.status, 0, String(result.stderr));
  assert.ok(result.stdout.length > 0);
  return result.stdout;
}

// Observe actual decoded audio, not a fake merge result or concat.txt spelling.
// Distinct provider tones make a wrong chunk order audible and detectable.
function assertPlayableOrder({ outputs, tones }: { outputs: string[]; tones: number[] }) {
  const observed: number[] = [];
  let decodedBytes = 0;
  for (const output of outputs) {
    const decoded = spawnSync(
      ffmpegInstaller.path,
      ["-v", "error", "-i", output, "-f", "s16le", "-ac", "1", "-ar", "8000", "pipe:1"],
      { maxBuffer: 64 * 1024 * 1024 }
    );
    assert.equal(decoded.status, 0, String(decoded.stderr));
    assert.ok(decoded.stdout.length > 0);
    decodedBytes += decoded.stdout.length;
    const samples = decoded.stdout;
    for (let offset = 0; offset + 800 <= samples.length; offset += 400) {
      let crossings = 0;
      let peak = 0;
      for (let index = offset + 2; index < offset + 800; index += 2) {
        const current = samples.readInt16LE(index);
        peak = Math.max(peak, Math.abs(current));
        if (samples.readInt16LE(index - 2) <= 0 && current > 0) {
          crossings += 1;
        }
      }
      if (peak < 100) {
        continue;
      }
      const frequency = crossings * 20;
      const nearest = [...tones].sort((left, right) => Math.abs(left - frequency) - Math.abs(right - frequency))[0];
      if (typeof nearest === "number" && Math.abs(nearest - frequency) <= 25 && observed.at(-1) !== nearest) {
        observed.push(nearest);
      }
    }
  }
  let cursor = 0;
  for (const tone of tones) {
    const found = observed.indexOf(tone, cursor);
    assert.ok(
      found >= cursor,
      `audio must contain tone ${tone} after preceding chunks, observed ${observed.join(",")}`
    );
    cursor = found + 1;
  }
  assert.ok(decodedBytes >= tones.length * 1200, "the output must contain playable audio for all chunks");
}

for (const entry of cases) {
  test(entry.name, { concurrency: false }, async (context) => {
    const originalHome = process.env.HOME;
    await withTempHome(
      async (home) => {
        const bin = path.resolve(import.meta.dirname, "..", "bin/cli.js");
        const configFile = path.join(home, ".ilu", ".config", "tts-config.json");
        fs.mkdirSync(path.dirname(configFile), { recursive: true });
        const token = "synthetic-capture-token";
        const requests: Array<{ input: string; voice: string; model: string; tone: number; success: boolean }> = [];
        const serverErrors: string[] = [];
        const audioByTone = new Map<number, Buffer>();
        const failureAt =
          entry.kind === "chunk-paths"
            ? 13
            : entry.kind === "printed-retry"
              ? 3
              : entry.kind === "resume" && entry.change !== "legacy"
                ? 2
                : 0;
        // Built-in HTTP supplies a controlled external service without adding a
        // dependency. The real OpenAI SDK consumes its supported OPENAI_BASE_URL.
        // No prompt, model, filesystem, merger or application method is mocked.
        const server = http.createServer(async (request, response) => {
          try {
            assert.equal(request.method, "POST");
            assert.equal(request.url, "/v1/audio/speech");
            assert.equal(request.headers.authorization, `Bearer ${token}`);
            const chunks: Buffer[] = [];
            for await (const chunk of request) {
              chunks.push(Buffer.from(chunk));
            }
            const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            assert.equal(typeof body.input, "string");
            assert.equal(typeof body.voice, "string");
            assert.equal(typeof body.model, "string");
            // Reuse twelve distinguishable, sub-Nyquist tones even for inputs
            // with hundreds of short sentences. Generate each fixture only once.
            const tone = 380 + (requests.length % 12) * 80;
            const success = requests.length + 1 !== failureAt;
            requests.push({ input: body.input, voice: body.voice, model: body.model, tone, success });
            if (!success) {
              // 400 is a terminal provider error, avoiding automatic SDK retries.
              response.writeHead(400, { "content-type": "application/json" });
              response.end(
                JSON.stringify({ error: { message: "Controlled audio interruption", type: "invalid_request_error" } })
              );
              return;
            }
            let audio = audioByTone.get(tone);
            if (!Buffer.isBuffer(audio)) {
              audio = audioBytes(tone);
              audioByTone.set(tone, audio);
            }
            response.writeHead(200, { "content-type": "audio/mpeg" });
            response.end(audio);
          } catch (error) {
            serverErrors.push(String(error));
            response.writeHead(400, { "content-type": "application/json" });
            response.end(JSON.stringify({ error: { message: "Invalid local fixture request" } }));
          }
        });
        await new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(0, "127.0.0.1", resolve);
        });
        const address = server.address();
        assert.ok(typeof address === "object" && address !== null);
        const baseUrl = `http://127.0.0.1:${address.port}/v1`;
        try {
          const noKey = [
            "home",
            "choose-voice",
            "missing-key",
            "old-config",
            "overwrite",
            "invalid-extension",
            "invalid-voice"
          ].includes(entry.kind);
          if (!noKey) {
            fs.writeFileSync(
              configFile,
              JSON.stringify({ apiKey: token, voice: entry.kind === "saved-config" ? "nova" : "alloy" }),
              { mode: 0o600 }
            );
          }
          if (entry.kind === "invalid-voice") {
            fs.writeFileSync(configFile, JSON.stringify({ voice: "badvoice" }), { mode: 0o600 });
          }
          if (entry.kind === "old-config") {
            const legacy = path.join(home, ".ilu", ".sync", "config.json");
            fs.mkdirSync(path.dirname(legacy), { recursive: true });
            fs.writeFileSync(legacy, JSON.stringify({ tts: { apiKey: "synthetic-old-token", voice: "nova" } }));
            fs.writeFileSync(
              path.join(home, ".ilu", ".config", "sync-config.json"),
              JSON.stringify({ enabled: true, remoteUrl: "./tmp/not-used.git" })
            );
          }
          const paragraphs = ["Primer párrafo ", "Segundo párrafo ", "Tercer párrafo "]
            .map((prefix, index) => prefix + String.fromCharCode(97 + index).repeat(1400) + ".")
            .join("\n\n");
          let inputs = [entry.kind === "missing-key" || entry.kind === "old-config" ? "# Hola\n\nMundo" : "Hola breve"];
          if (["paragraphs", "concat-order", "merge-failure", "printed-retry"].includes(entry.kind)) {
            inputs = [paragraphs];
          }
          if (entry.kind === "sentences") {
            inputs = [
              ["Primera oración ", "Segunda oración ", "Tercera oración "]
                .map((prefix, index) => prefix + String.fromCharCode(97 + index).repeat(1400) + ".")
                .join(" ")
            ];
          }
          if (entry.kind === "length") {
            inputs = ["a".repeat(4500)];
          }
          if (entry.kind === "chunk-paths") {
            inputs = ["x".repeat(26001)];
          }
          if (entry.kind === "resume") {
            inputs = ["a".repeat(4000)];
          }
          if (entry.kind === "multilingual") {
            inputs = [
              "こんにちは🙂".repeat(500),
              "... " + "Hello world. ".repeat(180),
              " \t\n" + ["First paragraph.  ", "Second paragraph?!\t"].join("\r\n\r\n").repeat(100) + "\n  ",
              "...!? ".repeat(400)
            ];
          }
          const directory = path.join(home, "dir with space and 'quote'");
          fs.mkdirSync(directory);
          const sources = inputs.map((_input, index) =>
            path.join(
              directory,
              `chapter ${index}.${entry.kind === "invalid-extension" ? "json" : entry.kind === "missing-key" || entry.kind === "old-config" ? "md" : "txt"}`
            )
          );
          const outputs = inputs.map((_input, index) =>
            path.join(
              directory,
              entry.kind === "merge-failure" ? `result ${index}.unsupported` : `chapter's mix ${index}.mp3`
            )
          );
          for (const [index, input] of inputs.entries()) {
            fs.writeFileSync(sources[index], input);
          }
          const parts = path.join(directory, `.${path.basename(outputs[0])}.parts`);
          let fixtureRequests = 0;
          if (entry.kind === "resume") {
            if (entry.change === "legacy") {
              fs.mkdirSync(parts);
              fs.writeFileSync(path.join(parts, `${path.basename(outputs[0], ".mp3")}-0001.mp3`), audioBytes(220));
            } else {
              // A real prior job is fixture preparation, like seeding a DB. The
              // captured retry uses the public CLI/TUI with the current defaults.
              // Only the external HTTP service is substituted, never job logic.
              const originalBase = process.env.OPENAI_BASE_URL;
              process.env.OPENAI_BASE_URL = baseUrl;
              try {
                const prior = createTtsService({
                  model: entry.change === "model" ? "tts-1" : "gpt-4o-mini-tts",
                  maxChunkLength: entry.change === "chunk-size" ? 1000 : 2000
                });
                await assert.rejects(
                  prior.action({ inputFile: sources[0], outputFile: outputs[0], voice: "alloy" }),
                  /Controlled audio interruption/
                );
              } finally {
                if (typeof originalBase === "string") {
                  process.env.OPENAI_BASE_URL = originalBase;
                } else {
                  delete process.env.OPENAI_BASE_URL;
                }
              }
              assert.equal(fs.existsSync(outputs[0]), false);
            }
            fixtureRequests = requests.length;
            if (entry.change === "text") {
              inputs = ["b".repeat(4000)];
              fs.writeFileSync(sources[0], inputs[0]);
            }
            if (entry.change === "voice") {
              fs.writeFileSync(configFile, JSON.stringify({ apiKey: token, voice: "nova" }), { mode: 0o600 });
            }
          }
          const environment = ["env", `HOME=${home}`, "OPENAI_API_KEY=", `OPENAI_BASE_URL=${baseUrl}`];
          let command = [...environment, "node", bin, "ui"];
          const steps: Array<Record<string, unknown>> = [];
          let expectedExit = 0;
          if (entry.kind === "home" || entry.kind === "choose-voice") {
            command = [...environment, "node", bin, "tts", "voice"];
            steps.push({ waitFor: "Select a default TTS voice" }, { checkpoint: "supported-voices" });
            if (entry.kind === "choose-voice") {
              for (let index = 0; index < 8; index++) {
                steps.push({ press: "DOWN" });
              }
            }
            steps.push({ press: "ENTER" });
          } else if (
            [
              "overwrite",
              "invalid-extension",
              "invalid-voice",
              "missing-key",
              "old-config",
              "chunk-paths",
              "merge-failure",
              "printed-retry"
            ].includes(entry.kind)
          ) {
            command = [
              ...environment,
              "node",
              bin,
              "tts",
              sources[0],
              entry.kind === "overwrite" ? sources[0] : outputs[0]
            ];
            if (entry.kind === "missing-key" || entry.kind === "old-config") {
              steps.push({ waitFor: "OpenAI API key" }, { checkpoint: "api-key" }, { type: token }, { press: "ENTER" });
            }
            if (
              ["overwrite", "invalid-extension", "invalid-voice", "chunk-paths", "merge-failure"].includes(entry.kind)
            ) {
              expectedExit = 1;
            }
            if (entry.kind === "printed-retry") {
              const aliasDir = path.join(home, "bin");
              fs.mkdirSync(aliasDir);
              fs.writeFileSync(
                path.join(aliasDir, "ilu"),
                `#!/bin/sh\nexec node '${bin.replaceAll("'", "'\\''")}' "$@"\n`,
                { mode: 0o700 }
              );
              // The host waits silently for the actual copyable retry command.
              // The driver must extract/validate that command from application
              // output, then type it as a user would. Never synthesize its args.
              command = [
                ...environment,
                `PATH=${aliasDir}:${process.env.PATH ?? ""}`,
                "sh",
                "-c",
                'node "$1" tts "$2" "$3"; code=$?; [ "$code" -eq 1 ] || exit 2; IFS= read -r retry; exec sh -c "$retry"',
                "ilu-capture",
                bin,
                sources[0],
                outputs[0]
              ];
              steps.push(
                { waitFor: "Retry with:" },
                {
                  checkpoint: "interrupted",
                  files: [
                    path.join(parts, `${path.basename(outputs[0], ".mp3")}-0001.mp3`),
                    path.join(parts, `${path.basename(outputs[0], ".mp3")}-0002.mp3`)
                  ]
                },
                { typePrintedRetry: { executable: "ilu", allowedHome: home } }
              );
            }
          } else {
            steps.push({ clickText: "Speech" }, { waitFor: "Text to Speech" });
            if (entry.kind === "explicit-voice") {
              steps.push(
                { clickText: "Choose voice" },
                { clickText: "nova" },
                { press: "ENTER" },
                { waitFor: "Start conversion" },
                { checkpoint: "explicit-voice" },
                { writeFile: { path: configFile, content: JSON.stringify({ apiKey: token, voice: "alloy" }) } }
              );
            }
            for (let index = 0; index < sources.length; index++) {
              steps.push(
                { clickText: "Input file", rowOffset: 1 },
                { press: "CTRL_A" },
                { type: entry.kind === "relative-output" ? path.relative(home, sources[index]) : sources[index] },
                { clickText: "Output file", rowOffset: 1 },
                { press: "CTRL_A" },
                { type: entry.kind === "relative-output" ? path.relative(home, outputs[index]) : outputs[index] },
                { clickText: "Start conversion" },
                { waitForFile: outputs[index] },
                { waitFor: "Audio ready" },
                { checkpoint: `audio-${index}` }
              );
            }
            steps.push({ clickText: "Todo" }, { press: "CTRL_C" });
          }
          const sourceBefore = fs.readFileSync(sources[0], "utf8");
          const configBefore = fs.existsSync(configFile) ? fs.readFileSync(configFile, "utf8") : null;
          const result = await captureIluScenario({
            testName: context.name,
            command,
            cwd: home,
            scenario: "cliScript",
            input: { steps },
            viewport: { cols: 140, rows: 44 }
          });
          assert.equal(result.exitCode, expectedExit);
          assert.deepEqual(serverErrors, []);
          assert.equal(process.env.HOME, home);
          const actual = requests.slice(fixtureRequests);
          const successful = actual.filter((request) => request.success);
          if (entry.kind === "home" || entry.kind === "choose-voice") {
            assert.equal(requests.length, 0);
            assert.equal(
              JSON.parse(fs.readFileSync(configFile, "utf8")).voice,
              entry.kind === "home" ? "alloy" : "sage"
            );
            if (entry.kind === "choose-voice") {
              for (const voice of [
                "alloy",
                "ash",
                "ballad",
                "coral",
                "echo",
                "fable",
                "nova",
                "onyx",
                "sage",
                "shimmer"
              ]) {
                assert.ok(result.frames["supported-voices"].includes(voice));
              }
            }
          } else if (["overwrite", "invalid-extension", "invalid-voice"].includes(entry.kind)) {
            assert.equal(requests.length, 0, "validation must precede every provider request");
            assert.equal(fs.readFileSync(sources[0], "utf8"), sourceBefore);
            assert.equal(fs.existsSync(outputs[0]), false);
            assert.equal(fs.existsSync(parts), false);
            assert.equal(fs.existsSync(configFile) ? fs.readFileSync(configFile, "utf8") : null, configBefore);
            assert.match(
              result.currentScreen,
              entry.kind === "overwrite"
                ? /output file must be different from input file/i
                : entry.kind === "invalid-extension"
                  ? /Only \.txt and \.md input files are supported/i
                  : /supported voice/i
            );
            assert.doesNotMatch(result.currentScreen, /OpenAI API key|ECONNREFUSED/i);
          } else if (entry.kind === "chunk-paths" || entry.kind === "merge-failure") {
            assert.equal(fs.existsSync(outputs[0]), false);
            assert.ok(fs.statSync(parts).isDirectory());
            const retained = fs
              .readdirSync(parts)
              .filter((name) => /-\d{4}\.mp3$/.test(name))
              .sort();
            assert.equal(retained.length, entry.kind === "chunk-paths" ? 12 : successful.length);
            assert.equal(successful.length, entry.kind === "chunk-paths" ? 12 : 3);
            assert.equal(actual.filter((request) => !request.success).length, entry.kind === "chunk-paths" ? 1 : 0);
            assert.deepEqual(
              retained,
              retained.map(
                (_name, index) =>
                  `${path.basename(outputs[0], path.extname(outputs[0]))}-${String(index + 1).padStart(4, "0")}.mp3`
              )
            );
            assertPlayableOrder({
              outputs: retained.map((name) => path.join(parts, name)),
              tones: successful.map((request) => request.tone)
            });
            assert.match(
              result.currentScreen,
              entry.kind === "chunk-paths" ? /Retry with:.*ilu tts/ : /format|ffmpeg|Invalid argument/i
            );
          } else {
            for (const request of actual) {
              assert.ok(Buffer.byteLength(request.input, "utf8") <= 2000);
              assert.equal(
                request.voice,
                entry.kind === "saved-config" ||
                  entry.kind === "explicit-voice" ||
                  (entry.kind === "resume" && entry.change === "voice")
                  ? "nova"
                  : "alloy"
              );
              assert.equal(request.model, "gpt-4o-mini-tts");
            }
            const expectedText =
              entry.kind === "resume" && entry.change === "none" ? inputs[0].slice(2000) : inputs.join("");
            assert.equal(successful.map((request) => request.input).join(""), expectedText);
            if (
              ["short", "saved-config", "explicit-voice", "relative-output", "missing-key", "old-config"].includes(
                entry.kind
              )
            ) {
              assert.equal(successful.length, 1);
            }
            if (
              entry.kind === "paragraphs" ||
              entry.kind === "sentences" ||
              entry.kind === "length" ||
              entry.kind === "concat-order"
            ) {
              assert.equal(successful.length, 3);
            }
            if (entry.kind === "paragraphs") {
              assert.ok(successful.slice(0, -1).every((request) => request.input.endsWith("\n\n")));
            }
            if (entry.kind === "sentences") {
              assert.ok(successful.every((request) => /\.\s*$/.test(request.input)));
            }
            if (entry.kind === "length") {
              assert.deepEqual(
                successful.map((request) => request.input.length),
                [2000, 2000, 500]
              );
            }
            if (entry.kind === "printed-retry") {
              assert.equal(actual.filter((request) => !request.success).length, 1);
              assert.equal(actual.length, 4);
              assert.match(result.frames.interrupted, /Retry with:/);
              assert.match(result.frames.interrupted, /chapter.*mix/);
              assert.equal(Object.keys(result.fileSnapshots.interrupted).length, 2);
            }
            const tones =
              entry.kind === "resume" && entry.change === "none"
                ? [requests[0].tone, ...successful.map((request) => request.tone)]
                : successful.map((request) => request.tone);
            assertPlayableOrder({ outputs, tones });
            for (const output of outputs) {
              assert.equal(
                fs.existsSync(path.join(path.dirname(output), `.${path.basename(output)}.parts`)),
                false,
                "successful merge must clean active chunks"
              );
            }
            if (entry.kind === "saved-config") {
              assert.equal(fs.readFileSync(configFile, "utf8"), configBefore);
            }
            if (entry.kind === "explicit-voice") {
              assert.equal(
                JSON.parse(fs.readFileSync(configFile, "utf8")).voice,
                "alloy",
                "the live explicit choice must override an externally changed stored fallback"
              );
            }
            if (entry.kind === "missing-key" || entry.kind === "old-config") {
              assert.equal(JSON.parse(fs.readFileSync(configFile, "utf8")).apiKey, token);
              assert.equal(fs.statSync(configFile).mode & 0o777, 0o600);
              assert.doesNotMatch(result.frames["api-key"], new RegExp(token));
            }
          }
          if (entry.kind === "home" || entry.kind === "choose-voice") {
            assert.equal(fs.statSync(configFile).mode & 0o777, 0o600);
          }
          assertCaptureArtifacts({
            result,
            checkpoints: [
              ...steps.flatMap((step) => (typeof step.checkpoint === "string" ? [step.checkpoint] : [])),
              "cli-result"
            ],
            testName: context.name,
            diagnostic: (message) => context.diagnostic(message)
          });
        } finally {
          await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
        }
      },
      { prefix: "ilu-tts-physical-", testName: context.name }
    );
    assert.equal(process.env.HOME, originalHome);
  });
}
