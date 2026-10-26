import fs from 'node:fs';
import path from 'node:path';
import childProcess from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import OpenAI from 'openai';
import localPaths from '../utils/local-paths';
import configStore from '../utils/config-store';
import prompts from '../utils/prompts';
const DEFAULT_MODEL = 'gpt-4o-mini-tts';
const DEFAULT_VOICE = 'alloy';
// Speech accepts 4096 characters; gpt-4o-mini-tts also caps input at 2000 tokens.
// A UTF-8 byte budget bounds byte-level BPE tokens without a tokenizer dependency.
const DEFAULT_MAX_CHUNK_LENGTH = 2000;
const MAX_CHUNK_BYTES = 2000;
const SUPPORTED_INPUT_EXTENSIONS = new Set(['.txt', '.md']);
const VOICE_CATALOG = [
    'alloy',
    'ash',
    'ballad',
    'coral',
    'echo',
    'fable',
    'nova',
    'onyx',
    'sage',
    'shimmer'
] as const;
const SUPPORTED_VOICES = VOICE_CATALOG.slice();

type SupportedVoice = (typeof VOICE_CATALOG)[number];
type TtsFileSystem = Pick<typeof fs, 'mkdirSync' | 'writeFileSync' | 'rmSync' | 'rmdirSync' | 'existsSync' | 'readFileSync' | 'renameSync'> & {
    realpathSync?: (filePath: string) => string;
};
type LocalPaths = typeof localPaths;
type PromptQuestion = {
    type: string;
    name: string;
    message: string;
    choices?: Array<{name: string; value: SupportedVoice}>;
    default?: string;
    mask?: string;
};
type PromptRunner = (questions: PromptQuestion[]) => Promise<Record<string, unknown>>;
type SpeechResponse = {arrayBuffer: () => Promise<ArrayBuffer>};
type OpenAIClient = {
    audio: {
        speech: {
            create: (input: {model: string; voice: SupportedVoice; input: string}) => Promise<SpeechResponse>;
        };
    };
};
type CreateOpenAI = (options: ConstructorParameters<typeof OpenAI>[0]) => OpenAIClient;
type FfmpegInstaller = {path: string};
type SpawnSync = typeof childProcess.spawnSync;
type MergeChunkFilesOptions = {
    chunkFiles: string[];
    outputFile: string;
    ffmpegPath?: string;
    fs?: TtsFileSystem;
    spawnSync?: SpawnSync;
};
type CleanupChunkFilesOptions = {fs?: TtsFileSystem};
type ConfigOptions = {fs?: TtsFileSystem; localPaths?: LocalPaths};
type DefaultVoiceOptions = ConfigOptions & {fallback?: string};
type ResolveVoiceOptions = ConfigOptions & {prompt?: PromptRunner; voice?: unknown; voices?: readonly SupportedVoice[]};
type ResolveApiKeyOptions = ConfigOptions & {prompt?: PromptRunner};
type TtsActionArgs = {inputFile: string; outputFile: string; voice?: string};
type TtsVoiceArgs = {voice?: string};
type TtsServiceOptions = ConfigOptions & {
    prompt?: PromptRunner;
    createOpenAI?: CreateOpenAI;
    mergeChunkFiles?: (options: MergeChunkFilesOptions) => Promise<{outputFile: string}> | {outputFile: string};
    resolveFfmpegBinaryPath?: () => string;
    model?: string;
    defaultVoice?: string;
    maxChunkLength?: number;
};

function defaultCreateOpenAI(options: ConstructorParameters<typeof OpenAI>[0]): OpenAIClient {
    return new OpenAI(options) as OpenAIClient;
}

function ensureParentDir(filePath: string) {
    fs.mkdirSync(path.dirname(filePath), {recursive: true});
}

function getChunkDirForOutput(outputFile: string) {
    return path.join(path.dirname(outputFile), `.${path.basename(outputFile)}.parts`);
}

function getChunkFilePath(outputFile: string, chunkIndex: number) {
    let baseName = path.basename(outputFile, path.extname(outputFile));
    let suffix = `${chunkIndex + 1}`.padStart(4, '0');
    return path.join(getChunkDirForOutput(outputFile), `${baseName}-${suffix}.mp3`);
}

function escapeFfmpegConcatPath(filePath: string) {
    return `${filePath}`.replace(/'/g, `'\\''`);
}

function buildFfmpegConcatInput(chunkFiles: string[]) {
    return chunkFiles.map((filePath) => `file '${escapeFfmpegConcatPath(filePath)}'\n`).join('');
}

function resolveFfmpegPath(installer: FfmpegInstaller = ffmpegInstaller) {
    return installer.path;
}

function mergeChunkFiles({chunkFiles, outputFile, ffmpegPath = resolveFfmpegPath(), fs: fileSystem = fs, spawnSync = childProcess.spawnSync}: MergeChunkFilesOptions) {
    let chunkDir = getChunkDirForOutput(outputFile);
    let concatFile = path.join(chunkDir, 'concat.txt');
    let concatChunkFiles = chunkFiles.map((filePath) => path.resolve(filePath));

    ensureParentDir(outputFile);
    fileSystem.mkdirSync(chunkDir, {recursive: true});
    fileSystem.writeFileSync(concatFile, buildFfmpegConcatInput(concatChunkFiles), 'utf8');

    let result = spawnSync(ffmpegPath, [
        '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', concatFile,
        '-c', 'copy',
        outputFile
    ], {
        encoding: 'utf8'
    });

    fileSystem.rmSync(concatFile, {force: true});

    if (result.error) {
        throw result.error;
    }

    if (result.status !== 0) {
        throw new Error(result.stderr || result.stdout || 'ffmpeg merge failed');
    }

    return {outputFile};
}

function cleanupChunkFiles(chunkFiles: string[], {fs: fileSystem = fs}: CleanupChunkFilesOptions = {}) {
    for (let chunkFile of chunkFiles) {
        fileSystem.rmSync(chunkFile, {force: true});
    }

    if (chunkFiles.length === 0) {
        return;
    }

    let chunkDir = path.dirname(chunkFiles[0]);

    try {
        fileSystem.rmdirSync(chunkDir);
    } catch (error: unknown) {
        let code = error instanceof Error && 'code' in error ? (error as NodeJS.ErrnoException).code : null;

        if (code !== 'ENOTEMPTY' && code !== 'ENOENT') {
            throw error;
        }
    }
}

function quotePosixShellArgument(value: string) {
    return `'${`${value}`.replace(/'/g, `'"'"'`)}'`;
}

function getRetryCommand(inputFile: string, outputFile: string) {
    return `ilu tts ${quotePosixShellArgument(inputFile)} ${quotePosixShellArgument(outputFile)}`;
}

function readStoredApiKey({fs: fileSystem = fs, localPaths: paths = localPaths}: ConfigOptions = {}) {
    return configStore.getTtsConfig({fs: fileSystem, paths}).apiKey;
}

function getDefaultVoice({fs: fileSystem = fs, localPaths: paths = localPaths, fallback = DEFAULT_VOICE}: DefaultVoiceOptions = {}) {
    let config = configStore.getTtsConfig({fs: fileSystem, paths});
    return config.voice || fallback;
}

function isSupportedVoice(voice: unknown, voices: readonly SupportedVoice[] = SUPPORTED_VOICES): voice is SupportedVoice {
    return typeof voice === 'string' && (voices as readonly string[]).includes(voice);
}

function validateSupportedVoice(voice: unknown, voices: readonly SupportedVoice[] = SUPPORTED_VOICES) {
    if (!isSupportedVoice(voice, voices)) {
        throw new Error('Choose a supported voice');
    }

    return voice;
}

async function resolveVoice({
    voice = null,
    fs: fileSystem = fs,
    localPaths: paths = localPaths,
    prompt = prompts.prompt,
    voices = SUPPORTED_VOICES
}: ResolveVoiceOptions = {}) {
    let explicitVoice = `${voice || ''}`.trim();

    if (explicitVoice) {
        return validateSupportedVoice(explicitVoice, voices);
    }

    let answers = await prompt([{
        type: 'select',
        name: 'voice',
        message: 'Select a default TTS voice',
        choices: voices.map((value) => ({name: value, value})),
        default: getDefaultVoice({fs: fileSystem, localPaths: paths})
    }]);

    return validateSupportedVoice(`${answers.voice || ''}`.trim() || getDefaultVoice({fs: fileSystem, localPaths: paths}), voices);
}

function saveDefaultVoice(voice: unknown, {fs: fileSystem = fs, localPaths: paths = localPaths}: ConfigOptions = {}) {
    validateSupportedVoice(voice);
    let currentConfig = configStore.loadTtsConfig({fs: fileSystem, paths});
    return configStore.saveTtsConfig({...currentConfig, voice}, {fs: fileSystem, paths});
}

async function resolveApiKey({fs: fileSystem = fs, localPaths: paths = localPaths, prompt = prompts.prompt}: ResolveApiKeyOptions = {}) {
    let storedApiKey = readStoredApiKey({fs: fileSystem, localPaths: paths});

    if (storedApiKey) {
        return storedApiKey;
    }

    let answers = await prompt([{
        type: 'password',
        name: 'apiKey',
        message: 'OpenAI API key',
        mask: '*'
    }]);
    let apiKey = `${answers.apiKey || ''}`.trim();

    if (!apiKey) {
        throw new Error('An OpenAI API key is required to generate audio');
    }

    let currentConfig = configStore.loadTtsConfig({fs: fileSystem, paths});
    configStore.saveTtsConfig({...currentConfig, apiKey}, {fs: fileSystem, paths});

    return apiKey;
}

function validateInputFile(inputFile: string) {
    let extension = path.extname(inputFile || '').toLowerCase();

    if (!SUPPORTED_INPUT_EXTENSIONS.has(extension)) {
        throw new Error('Only .txt and .md input files are supported');
    }
}

function getComparablePath(filePath: string, fileSystem: TtsFileSystem = fs) {
    let absolutePath = path.resolve(filePath);

    if (fileSystem.existsSync(absolutePath) && typeof fileSystem.realpathSync === 'function') {
        return fileSystem.realpathSync(absolutePath);
    }

    return absolutePath;
}

function validateOutputFile(inputFile: string, outputFile: string, {fs: fileSystem = fs}: ConfigOptions = {}) {
    if (getComparablePath(inputFile, fileSystem) === getComparablePath(outputFile, fileSystem)) {
        throw new Error('Output file must be different from input file');
    }
}

function splitByParagraphs(input: unknown) {
    return `${input || ''}`.match(/[\s\S]+?(?:\n\s*\n+|$)/g) || [];
}

function splitBySentences(input: unknown) {
    return `${input || ''}`.match(/[^.!?]*[.!?]+\s*|[^.!?]+$/g) || [];
}

function splitByLength(input: unknown, maxChunkLength: number) {
    let value = `${input || ''}`;
    let chunks: string[] = [];
    let current = '';
    let bytes = 0;
    for (const character of value) {
        const length = Buffer.byteLength(character, 'utf8');
        if (current.length > 0 && (current.length + character.length > maxChunkLength || bytes + length > MAX_CHUNK_BYTES)) {
            chunks.push(current);
            current = '';
            bytes = 0;
        }
        current += character;
        bytes += length;
    }
    if (current.length > 0) {
        chunks.push(current);
    }

    return chunks;
}

function chunkText(input: unknown, maxChunkLength: number = DEFAULT_MAX_CHUNK_LENGTH) {
    if (!Number.isInteger(maxChunkLength) || maxChunkLength < 1) {
        throw new Error('Chunk length must be a positive integer');
    }
    let value = `${input || ''}`;
    if (!value || (value.length <= maxChunkLength && Buffer.byteLength(value, 'utf8') <= MAX_CHUNK_BYTES)) {
        return [value];
    }
    return splitByParagraphs(value).flatMap((paragraph) => {
        if (paragraph.length <= maxChunkLength && Buffer.byteLength(paragraph, 'utf8') <= MAX_CHUNK_BYTES) {
            return [paragraph];
        }
        return splitBySentences(paragraph).flatMap((sentence) => {
            if (sentence.length <= maxChunkLength && Buffer.byteLength(sentence, 'utf8') <= MAX_CHUNK_BYTES) {
                return [sentence];
            }
            return splitByLength(sentence, maxChunkLength);
        });
    });
}

function createTtsService({
    fs: fileSystem = fs,
    localPaths: paths = localPaths,
    prompt = prompts.prompt,
    createOpenAI = defaultCreateOpenAI,
    mergeChunkFiles: mergeChunks = mergeChunkFiles,
    resolveFfmpegBinaryPath = resolveFfmpegPath,
    model = DEFAULT_MODEL,
    defaultVoice = DEFAULT_VOICE,
    maxChunkLength = DEFAULT_MAX_CHUNK_LENGTH
}: TtsServiceOptions = {}) {
    if (!Number.isInteger(maxChunkLength) || maxChunkLength < 1) {
        throw new Error('Chunk length must be a positive integer');
    }
    return {
        async action(args: TtsActionArgs) {
            let inputFile = args.inputFile;
            let outputFile = args.outputFile;

            validateInputFile(inputFile);
            validateOutputFile(inputFile, outputFile, {fs: fileSystem});

            let input = fileSystem.readFileSync(inputFile, 'utf8');
            let chunks = chunkText(input, maxChunkLength);
            let voice = validateSupportedVoice(`${args.voice || getDefaultVoice({fs: fileSystem, localPaths: paths, fallback: defaultVoice})}`.trim());
            let apiKey = await resolveApiKey({fs: fileSystem, localPaths: paths, prompt});
            let client = createOpenAI({apiKey});
            let ffmpegPath = resolveFfmpegBinaryPath();
            let chunkDir = getChunkDirForOutput(outputFile);
            let chunkFiles = chunks.map((_chunk, index) => getChunkFilePath(outputFile, index));

            ensureParentDir(outputFile);
            const identity = createHash('sha256').update(JSON.stringify({model, voice, chunks, maxChunkLength, maxChunkBytes: MAX_CHUNK_BYTES})).digest('hex');
            const manifest = path.join(chunkDir, 'job.json');
            let previousIdentity: unknown = null;
            if (fileSystem.existsSync(manifest)) {
                try {
                    const stored: unknown = JSON.parse(fileSystem.readFileSync(manifest, 'utf8'));
                    if (typeof stored === 'object' && stored !== null && 'identity' in stored) {
                        previousIdentity = stored.identity;
                    }
                } catch (error) {
                    if (!(error instanceof SyntaxError)) {
                        throw error;
                    }
                }
            }
            if (fileSystem.existsSync(chunkDir) && previousIdentity !== identity) {
                fileSystem.renameSync(chunkDir, `${chunkDir}.previous-${randomUUID()}`);
            }
            fileSystem.mkdirSync(chunkDir, {recursive: true});
            fileSystem.writeFileSync(manifest, JSON.stringify({identity}), 'utf8');

            try {
                for (let index = 0; index < chunks.length; index += 1) {
                    if (fileSystem.existsSync(chunkFiles[index])) {
                        continue;
                    }

                    let response = await client.audio.speech.create({
                        model,
                        voice,
                        input: chunks[index]
                    });

                    const pendingChunk = `${chunkFiles[index]}.pending`;
                    fileSystem.writeFileSync(pendingChunk, Buffer.from(await response.arrayBuffer()));
                    fileSystem.renameSync(pendingChunk, chunkFiles[index]);
                }
            } catch (error: unknown) {
                let message = error instanceof Error ? error.message : String(error);
                throw new Error(`${message}\nRetry with: ${getRetryCommand(inputFile, outputFile)}`);
            }

            await mergeChunks({chunkFiles, outputFile, ffmpegPath});
            fileSystem.rmSync(manifest, {force: true});
            cleanupChunkFiles(chunkFiles, {fs: fileSystem});
            return {outputFile};
        },
        async voiceAction(args: TtsVoiceArgs, options: TtsVoiceArgs = {}) {
            let voice = await resolveVoice({voice: options.voice || args.voice, fs: fileSystem, localPaths: paths, prompt});
            saveDefaultVoice(voice, {fs: fileSystem, localPaths: paths});
            return {voice};
        }
    };
}

let tts = createTtsService();

const __defaultExport = Object.assign(tts, {
    createTtsService,
    readStoredApiKey,
    resolveApiKey,
    validateInputFile,
    validateOutputFile,
    getDefaultVoice,
    isSupportedVoice,
    validateSupportedVoice,
    resolveVoice,
    saveDefaultVoice,
    SUPPORTED_VOICES,
    chunkText,
    DEFAULT_MAX_CHUNK_LENGTH,
    getChunkDirForOutput,
    getChunkFilePath,
    buildFfmpegConcatInput,
    resolveFfmpegPath,
    mergeChunkFiles,
    getRetryCommand,
    cleanupChunkFiles
});
export const action = tts.action;
export const voiceAction = tts.voiceAction;
export {
    createTtsService,
    readStoredApiKey,
    resolveApiKey,
    validateInputFile,
    validateOutputFile,
    getDefaultVoice,
    isSupportedVoice,
    validateSupportedVoice,
    resolveVoice,
    saveDefaultVoice,
    SUPPORTED_VOICES,
    chunkText,
    DEFAULT_MAX_CHUNK_LENGTH,
    getChunkDirForOutput,
    getChunkFilePath,
    buildFfmpegConcatInput,
    resolveFfmpegPath,
    mergeChunkFiles,
    getRetryCommand,
    cleanupChunkFiles
};
export default __defaultExport;
