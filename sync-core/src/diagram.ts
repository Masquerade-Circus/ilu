import fs from "node:fs";
import path from "node:path";
// @ts-expect-error x-robot omits type conditions from its package exports.
import * as __cjsImport41 from "x-robot/documentate";
const { documentate } = __cjsImport41;
import * as __cjsImport42 from "./machine.js";
const { createSyncMachine } = __cjsImport42;
type GenerateSyncDiagramsOptions = {
  outDir?: string | null;
};

async function generateSyncDiagrams(options: GenerateSyncDiagramsOptions = {}) {
  const outDir = options.outDir || path.join(process.cwd(), "docs", "diagrams");
  const svgPath = path.join(outDir, "sync-machine.svg");
  const mermaidPath = path.join(outDir, "sync-machine.mmd");
  const machine = createSyncMachine({ status: "healthy", hasPendingRemote: false });

  fs.mkdirSync(outDir, { recursive: true });

  const svgResult = await documentate(machine, {
    format: "svg",
    output: svgPath,
    fileName: "sync-machine",
    level: "high"
  });

  const mermaidResult = await documentate(machine, {
    format: "mermaid",
    level: "high"
  });

  if (mermaidResult.mermaid) {
    fs.writeFileSync(mermaidPath, mermaidResult.mermaid, "utf8");
  }

  if (svgResult.svg && svgResult.svg !== svgPath && fs.existsSync(svgResult.svg)) {
    fs.copyFileSync(svgResult.svg, svgPath);
  }

  return {
    svgPath,
    mermaidPath
  };
}

export { generateSyncDiagrams };
export default {
  generateSyncDiagrams
};
