#!/usr/bin/env node
let {generateSyncDiagrams} = require('../sync-core/diagram');

generateSyncDiagrams()
    .then(result => {
        console.log(`Sync SVG diagram: ${result.svgPath}`);
        console.log(`Sync Mermaid diagram: ${result.mermaidPath}`);
    })
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
