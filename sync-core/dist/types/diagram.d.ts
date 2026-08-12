type GenerateSyncDiagramsOptions = {
    outDir?: string | null;
};
declare function generateSyncDiagrams(options?: GenerateSyncDiagramsOptions): Promise<{
    svgPath: string;
    mermaidPath: string;
}>;
export { generateSyncDiagrams };
declare const _default: {
    generateSyncDiagrams: typeof generateSyncDiagrams;
};
export default _default;
