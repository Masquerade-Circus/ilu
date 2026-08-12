import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const packageRoot = import.meta.dir;
const distDirectory = path.join(packageRoot, "dist");
const nodeEntrypoint = path.join(packageRoot, "src", "index.ts");
const browserEntrypoint = path.join(packageRoot, "src", "browser.ts");
const nodeSubpaths = [
  { name: "git", entrypoint: path.join(packageRoot, "src", "git.ts") },
  { name: "diagram", entrypoint: path.join(packageRoot, "src", "diagram.ts"), external: ["x-robot"] }
];

function wrapUmd({
  nodeBundle,
  browserBundle,
  minified
}: {
  nodeBundle: string;
  browserBundle: string;
  minified: boolean;
}) {
  if (minified) {
    return `(function(r,n,b){if(typeof module==="object"&&module.exports){module.exports=n(require)}else if(typeof define==="function"&&define.amd){define([],b)}else{r.SyncCore=b()}})(typeof globalThis!=="undefined"?globalThis:this,function(require){var module={exports:{}};var exports=module.exports;${nodeBundle}\nreturn module.exports},function(){var module={exports:{}};var exports=module.exports;${browserBundle}\nreturn module.exports});\n`;
  }

  return `(function (root, nodeFactory, browserFactory) {
    if (typeof module === "object" && module.exports) {
        module.exports = nodeFactory(require);
    } else if (typeof define === "function" && define.amd) {
        define([], browserFactory);
    } else {
        root.SyncCore = browserFactory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function (require) {
    var module = { exports: {} };
    var exports = module.exports;

${nodeBundle}

    return module.exports;
}, function () {
    var module = { exports: {} };
    var exports = module.exports;

${browserBundle}

    return module.exports;
});
`;
}

async function bundle({
  entrypoint,
  platform,
  format,
  minified,
  external = []
}: {
  entrypoint: string;
  platform: "browser" | "node";
  format: "cjs" | "esm";
  minified: boolean;
  external?: string[];
}) {
  const result = await build({
    entryPoints: [entrypoint],
    bundle: true,
    platform,
    format,
    minify: minified,
    sourcemap: false,
    target: platform === "browser" ? ["es2020"] : ["node20"],
    external,
    write: false
  });
  const output = result.outputFiles[0];

  if (output === void 0) {
    throw new Error(`esbuild did not produce output for ${entrypoint}`);
  }

  return output.text;
}

async function buildUmd({ minified, filename }: { minified: boolean; filename: string }) {
  const [nodeBundle, browserBundle] = await Promise.all([
    bundle({ entrypoint: nodeEntrypoint, platform: "node", format: "cjs", minified }),
    bundle({ entrypoint: browserEntrypoint, platform: "browser", format: "cjs", minified })
  ]);

  fs.writeFileSync(path.join(distDirectory, filename), wrapUmd({ nodeBundle, browserBundle, minified }), "utf8");
}

async function buildNodeSubpath({
  name,
  entrypoint,
  external
}: {
  name: string;
  entrypoint: string;
  external?: string[];
}) {
  const [commonJsBundle, esmBundle] = await Promise.all([
    bundle({ entrypoint, platform: "node", format: "cjs", minified: false, external }),
    bundle({ entrypoint, platform: "node", format: "esm", minified: false, external })
  ]);

  fs.writeFileSync(path.join(distDirectory, `${name}.cjs`), commonJsBundle, "utf8");
  fs.writeFileSync(path.join(distDirectory, `${name}.mjs`), esmBundle, "utf8");
}

fs.rmSync(distDirectory, { recursive: true, force: true });
fs.mkdirSync(distDirectory, { recursive: true });
fs.writeFileSync(path.join(distDirectory, "package.json"), '{"type":"commonjs"}\n', "utf8");

await buildUmd({ minified: false, filename: "sync-core.js" });
await buildUmd({ minified: true, filename: "sync-core.min.js" });
fs.writeFileSync(
  path.join(distDirectory, "index.mjs"),
  await bundle({ entrypoint: nodeEntrypoint, platform: "node", format: "esm", minified: false }),
  "utf8"
);
await Promise.all(nodeSubpaths.map(buildNodeSubpath));

const declarations = Bun.spawn(["bunx", "tsc", "--project", "tsconfig.build.json"], {
  cwd: packageRoot,
  stdout: "inherit",
  stderr: "inherit"
});

if ((await declarations.exited) !== 0) {
  throw new Error("TypeScript declaration generation failed");
}

const declarationDirectory = path.join(distDirectory, "types");
const generatedTypes = fs.readFileSync(path.join(declarationDirectory, "types.d.ts"), "utf8");
const publicTypeNames = [
  "Awaitable",
  "PublicSyncStatus",
  "SyncStatus",
  "SyncMutationContext",
  "SyncFailureKind",
  "SyncFailure",
  "SyncRequest",
  "SyncBackend",
  "NormalizedSyncState",
  "SyncRuntimeOptions",
  "SyncRuntime"
];
const declarationsByName = new Map<string, string>();
const declarationBlocks = generatedTypes.split(/(?=export type )/);
for (const block of declarationBlocks) {
  const match = /^export type (\w+)/.exec(block);
  if (match !== null) {
    declarationsByName.set(match[1], block.trim());
  }
}
const publicTypes = publicTypeNames.map((name) => {
  const declaration = declarationsByName.get(name);
  if (declaration === void 0) {
    throw new Error(`Missing public declaration for ${name}`);
  }
  return declaration;
});
const gitDeclarations = fs
  .readFileSync(path.join(declarationDirectory, "backends", "git-cli.d.ts"), "utf8")
  .replace('from "../types.js"', 'from "./index.js"')
  .replace(/declare const _default:[\s\S]*?export default _default;\s*$/, "");
const diagramDeclarations = fs.readFileSync(path.join(declarationDirectory, "diagram.d.ts"), "utf8");

fs.rmSync(declarationDirectory, { recursive: true, force: true });
fs.mkdirSync(declarationDirectory, { recursive: true });
fs.writeFileSync(
  path.join(declarationDirectory, "index.d.ts"),
  `${publicTypes.join("\n")}\nexport declare function createSyncRuntime(options: SyncRuntimeOptions): Promise<SyncRuntime>;\n`,
  "utf8"
);
fs.writeFileSync(path.join(declarationDirectory, "git.d.ts"), gitDeclarations, "utf8");
fs.writeFileSync(path.join(declarationDirectory, "diagram.d.ts"), diagramDeclarations, "utf8");
