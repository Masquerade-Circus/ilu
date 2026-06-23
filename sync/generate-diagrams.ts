#!/usr/bin/env node
let {generateSyncDiagrams} = require('../sync-core/diagram');

generateSyncDiagrams()
    .then((result: any) => {
        console.log(`Sync SVG diagram: ${result.svgPath}`);
        console.log(`Sync Mermaid diagram: ${result.mermaidPath}`);
    })
    .catch((error: any) => {
        console.error(error);
        process.exit(1);
    });
