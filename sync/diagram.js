let fs = require('node:fs');
let path = require('node:path');
let { documentate } = require('x-robot/documentate');
let { createSyncMachine } = require('./machine');

async function generateSyncDiagrams(options = {}) {
    let outDir = options.outDir || path.join(process.cwd(), 'docs', 'diagrams');
    let svgPath = path.join(outDir, 'sync-machine.svg');
    let mermaidPath = path.join(outDir, 'sync-machine.mmd');
    let machine = createSyncMachine({ enabled: true, status: 'healthy', hasPendingRemote: false });

    fs.mkdirSync(outDir, {recursive: true});

    let svgResult = await documentate(machine, {
        format: 'svg',
        output: svgPath,
        fileName: 'sync-machine',
        level: 'high'
    });

    let mermaidResult = await documentate(machine, {
        format: 'mermaid',
        level: 'high'
    });

    if (mermaidResult.mermaid) {
        fs.writeFileSync(mermaidPath, mermaidResult.mermaid, 'utf8');
    }

    if (svgResult.svg && svgResult.svg !== svgPath && fs.existsSync(svgResult.svg)) {
        fs.copyFileSync(svgResult.svg, svgPath);
    }

    return {
        svgPath,
        mermaidPath
    };
}

module.exports = {
    generateSyncDiagrams
};
