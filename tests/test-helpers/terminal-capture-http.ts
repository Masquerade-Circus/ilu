import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { MockAgent, setGlobalDispatcher } from "undici";
import { assertRepoTempHome } from "../../support/home-sandbox.ts";

// Intercept the external HTTP transport without replacing fetch or product modules.
assertRepoTempHome(process.env.HOME, "HTTP capture HOME");
const configPath = process.env.ILU_CAPTURE_HTTP_CONFIG;
if (typeof configPath !== "string") {
  throw new Error("Physical HTTP capture requires an isolation configuration");
}
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const agent = new MockAgent();
agent.disableNetConnect();
setGlobalDispatcher(agent);
if (typeof config.tuiProviderPath === "string") {
  agent
    .get("https://translate.google.com")
    .intercept({
      path: (value) => value.startsWith("/translate_a/single?"),
      method: "GET"
    })
    .reply((request) => {
      const fixture = fs.existsSync(config.tuiProviderPath)
        ? JSON.parse(fs.readFileSync(config.tuiProviderPath, "utf8"))
        : {};
      const response = fixture.response;
      const status =
        typeof response === "object" && response !== null
          ? (fixture.status ?? (Object.hasOwn(response, "error") ? 503 : 200))
          : null;
      fs.appendFileSync(
        config.requestsPath,
        JSON.stringify({
          service: "googleTranslate",
          url: `${request.origin}${request.path}`,
          method: request.method,
          status
        }) + "\n"
      );
      if (
        fixture.kind !== "translation" ||
        typeof response !== "object" ||
        response === null ||
        !Number.isInteger(status) ||
        status < 200 ||
        status > 599
      ) {
        throw new Error("The external translation request has no valid active fixture");
      }
      let data = JSON.stringify(response);
      if (Object.hasOwn(response, "deferred")) {
        if (typeof response.deferred !== "string" || !/^[a-z0-9-]+$/.test(response.deferred)) {
          throw new Error("Deferred external responses require a safe fixture ID");
        }
        data = async () => {
          const file = path.join(config.releasesDirectory, `${response.deferred}.json`);
          const deadline = Date.now() + 15000;
          while (!fs.existsSync(file)) {
            if (Date.now() >= deadline) {
              throw new Error("The external response fixture was not released");
            }
            await delay(20);
          }
          const release = JSON.parse(fs.readFileSync(file, "utf8"));
          return JSON.stringify(Object.hasOwn(release, "error") ? { error: release.error } : release.response);
        };
      }
      return { statusCode: status, data, responseOptions: { headers: { "content-type": "application/json" } } };
    })
    .persist();
}
const responses = Array.isArray(config.commands)
  ? config.responses.slice(Number(process.env.ILU_CAPTURE_HTTP_INDEX), Number(process.env.ILU_CAPTURE_HTTP_INDEX) + 1)
  : config.responses;
for (const response of responses) {
  agent
    .get("https://translate.google.com")
    .intercept({
      path: (value) => value.startsWith("/translate_a/single?"),
      method: "GET"
    })
    .reply((request) => {
      const entries = Array.isArray(request.headers)
        ? Array.from({ length: request.headers.length / 2 }, (_, index) => [
            request.headers[index * 2],
            request.headers[index * 2 + 1]
          ])
        : Object.entries(request.headers);
      const headers = Object.fromEntries(entries.map(([name, value]) => [name.toLowerCase(), value]));
      fs.appendFileSync(
        config.requestsPath,
        `${JSON.stringify({ service: "googleTranslate", commandIndex: Number(process.env.ILU_CAPTURE_HTTP_INDEX ?? 0), url: `${request.origin}${request.path}`, method: request.method, headers })}\n`
      );
      return {
        statusCode: response.status,
        data: JSON.stringify(response.body ?? null),
        responseOptions: { headers: { "content-type": "application/json" } }
      };
    });
}
if (typeof config.tuiProviderPath === "string" && typeof config.openaiAudioBase64 === "string") {
  agent
    .get("https://api.openai.com")
    .intercept({ path: "/v1/audio/speech", method: "POST" })
    .reply((request) => {
      const fixture = fs.existsSync(config.tuiProviderPath)
        ? JSON.parse(fs.readFileSync(config.tuiProviderPath, "utf8"))
        : {};
      const response = fixture.response;
      const status =
        typeof response === "object" && response !== null
          ? (response.status ?? (Object.hasOwn(response, "error") ? 400 : 200))
          : null;
      fs.appendFileSync(
        config.requestsPath,
        JSON.stringify({ service: "openai", method: request.method, body: JSON.parse(String(request.body)), status }) +
          "\n"
      );
      if (
        fixture.kind !== "speech" ||
        typeof response !== "object" ||
        response === null ||
        ![200, 400].includes(status)
      ) {
        throw new Error("The external audio request must have an active success or non-retryable rejection fixture");
      }
      const encode = (value) =>
        Object.hasOwn(value, "error")
          ? JSON.stringify({ error: { message: value.error, type: "invalid_request_error" } })
          : Buffer.from(config.openaiAudioBase64, "base64");
      let data = encode(response);
      if (Object.hasOwn(response, "deferred")) {
        if (typeof response.deferred !== "string" || !/^[a-z0-9-]+$/.test(response.deferred)) {
          throw new Error("Deferred audio responses require a safe fixture ID");
        }
        data = async () => {
          const file = path.join(config.releasesDirectory, `${response.deferred}.json`);
          const deadline = Date.now() + 15000;
          while (!fs.existsSync(file)) {
            if (Date.now() >= deadline) {
              throw new Error("The synthetic audio response was not released");
            }
            await delay(20);
          }
          return encode(JSON.parse(fs.readFileSync(file, "utf8")));
        };
      }
      return {
        statusCode: status,
        data,
        responseOptions: { headers: { "content-type": status === 200 ? "audio/mpeg" : "application/json" } }
      };
    })
    .persist();
} else if (typeof config.openaiAudioBase64 === "string") {
  agent
    .get("https://api.openai.com")
    .intercept({ path: "/v1/audio/speech", method: "POST" })
    .reply((request) => {
      const body = JSON.parse(String(request.body));
      fs.appendFileSync(
        config.requestsPath,
        `${JSON.stringify({ service: "openai", commandIndex: Number(process.env.ILU_CAPTURE_HTTP_INDEX ?? 0), method: request.method, body })}\n`
      );
      return {
        statusCode: 200,
        data: Buffer.from(config.openaiAudioBase64, "base64"),
        responseOptions: { headers: { "content-type": "audio/mpeg" } }
      };
    });
}
