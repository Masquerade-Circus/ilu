#!/usr/bin/env node
import * as __cjsImport26 from 'sync-core/diagram';
const { generateSyncDiagrams } = __cjsImport26;
generateSyncDiagrams()
    .then((result: Awaited<ReturnType<typeof generateSyncDiagrams>>) => {
        console.log(`Sync SVG diagram: ${result.svgPath}`);
        console.log(`Sync Mermaid diagram: ${result.mermaidPath}`);
    })
    .catch((error: unknown) => {
        console.error(error);
        process.exit(1);
    });
