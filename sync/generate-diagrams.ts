#!/usr/bin/env node
import * as __cjsImport26 from '../sync-core/diagram.ts';
const { generateSyncDiagrams } = __cjsImport26;
generateSyncDiagrams()
    .then((result: any) => {
        console.log(`Sync SVG diagram: ${result.svgPath}`);
        console.log(`Sync Mermaid diagram: ${result.mermaidPath}`);
    })
    .catch((error: any) => {
        console.error(error);
        process.exit(1);
    });
