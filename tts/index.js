let fs = require('node:fs');
let path = require('node:path');
let childProcess = require('node:child_process');
let localPaths = require('../utils/local-paths');
let configStore = require('../utils/config-store');
let inquirer = require('../utils/inquirer');

const DEFAULT_MODEL = 'gpt-4o-mini-tts';
const DEFAULT_VOICE = 'alloy';
const DEFAULT_MAX_CHUNK_LENGTH = 50000;
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
];
const SUPPORTED_VOICES = VOICE_CATALOG.slice();

function defaultCreateOpenAI(options) {
    let OpenAI = require('openai');
    return new OpenAI(options);
}

function ensureParentDir(filePath) {
    fs.mkdirSync(path.dirname(filePath), {recursive: true});
}

function getChunkDirForOutput(outputFile) {
    return path.join(path.dirname(outputFile), `.${path.basename(outputFile)}.parts`);
}

function getChunkFilePath(outputFile, chunkIndex) {
    let baseName = path.basename(outputFile, path.extname(outputFile));
    let suffix = `${chunkIndex + 1}`.padStart(4, '0');
    return path.join(getChunkDirForOutput(outputFile), `${baseName}-${suffix}.mp3`);
}

function escapeFfmpegConcatPath(filePath) {
    return `${filePath}`.replace(/'/g, `'\\''`);
}

function buildFfmpegConcatInput(chunkFiles) {
    return chunkFiles.map(filePath => `file '${escapeFfmpegConcatPath(filePath)}'\n`).join('');
}

function resolveFfmpegPath(ffmpegInstaller = require('@ffmpeg-installer/ffmpeg')) {
    return ffmpegInstaller.path;
}

function mergeChunkFiles({chunkFiles, outputFile, ffmpegPath = resolveFfmpegPath(), fs: fileSystem = fs, spawnSync = childProcess.spawnSync} = {}) {
    let chunkDir = getChunkDirForOutput(outputFile);
    let concatFile = path.join(chunkDir, 'concat.txt');
    let concatChunkFiles = chunkFiles.map(filePath => path.resolve(filePath));

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

function cleanupChunkFiles(chunkFiles, {fs: fileSystem = fs} = {}) {
    for (let chunkFile of chunkFiles) {
        fileSystem.rmSync(chunkFile, {force: true});
    }

    if (chunkFiles.length === 0) {
        return;
    }

    let chunkDir = path.dirname(chunkFiles[0]);

    try {
        fileSystem.rmdirSync(chunkDir);
    } catch (error) {
        if (!error || (error.code !== 'ENOTEMPTY' && error.code !== 'ENOENT')) {
            throw error;
        }
    }
}

function quotePosixShellArgument(value) {
    return `'${`${value}`.replace(/'/g, `'"'"'`)}'`;
}

function getRetryCommand(inputFile, outputFile) {
    return `ilu tts ${quotePosixShellArgument(inputFile)} ${quotePosixShellArgument(outputFile)}`;
}

function readStoredApiKey({fs: fileSystem = fs, localPaths: paths = localPaths} = {}) {
    return configStore.getTtsConfig({fs: fileSystem, paths}).apiKey;
}

function getDefaultVoice({fs: fileSystem = fs, localPaths: paths = localPaths, fallback = DEFAULT_VOICE} = {}) {
    let config = configStore.getTtsConfig({fs: fileSystem, paths});
    return config.voice || fallback;
}

async function resolveVoice({
    voice = null,
    fs: fileSystem = fs,
    localPaths: paths = localPaths,
    prompt = inquirer.prompt,
    voices = SUPPORTED_VOICES
} = {}) {
    let explicitVoice = `${voice || ''}`.trim();

    if (explicitVoice) {
        return explicitVoice;
    }

    let answers = await prompt([{
        type: 'select',
        name: 'voice',
        message: 'Select a default TTS voice',
        choices: voices.map(value => ({name: value, value})),
        default: getDefaultVoice({fs: fileSystem, localPaths: paths})
    }]);

    return `${answers.voice || ''}`.trim() || getDefaultVoice({fs: fileSystem, localPaths: paths});
}

function saveDefaultVoice(voice, {fs: fileSystem = fs, localPaths: paths = localPaths} = {}) {
    let currentConfig = configStore.loadTtsConfig({fs: fileSystem, paths});
    return configStore.saveTtsConfig({...currentConfig, voice}, {fs: fileSystem, paths});
}

async function resolveApiKey({fs: fileSystem = fs, localPaths: paths = localPaths, prompt = inquirer.prompt} = {}) {
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

function validateInputFile(inputFile) {
    let extension = path.extname(inputFile || '').toLowerCase();

    if (!SUPPORTED_INPUT_EXTENSIONS.has(extension)) {
        throw new Error('Only .txt and .md input files are supported');
    }
}

function splitByParagraphs(input) {
    return `${input || ''}`
        .split(/\n\s*\n+/)
        .map(chunk => chunk.trim())
        .filter(Boolean);
}

function splitBySentences(input) {
    let matches = `${input || ''}`.match(/[^.!?]+[.!?]+|[^.!?]+$/g);

    return (matches || [])
        .map(chunk => chunk.trim())
        .filter(Boolean);
}

function splitByLength(input, maxChunkLength) {
    let value = `${input || ''}`;
    let chunks = [];
    let index = 0;

    while (index < value.length) {
        chunks.push(value.slice(index, index + maxChunkLength));
        index += maxChunkLength;
    }

    return chunks;
}

function chunkText(input, maxChunkLength = DEFAULT_MAX_CHUNK_LENGTH) {
    let value = `${input || ''}`;

    if (!value || value.length <= maxChunkLength) {
        return [value];
    }

    return splitByParagraphs(value).flatMap(paragraph => {
        if (paragraph.length <= maxChunkLength) {
            return [paragraph];
        }

        return splitBySentences(paragraph).flatMap(sentence => {
            if (sentence.length <= maxChunkLength) {
                return [sentence];
            }

            return splitByLength(sentence, maxChunkLength);
        });
    });
}

function createTtsService({
    fs: fileSystem = fs,
    localPaths: paths = localPaths,
    prompt = inquirer.prompt,
    createOpenAI = defaultCreateOpenAI,
    mergeChunkFiles: mergeChunks = mergeChunkFiles,
    resolveFfmpegBinaryPath = resolveFfmpegPath,
    model = DEFAULT_MODEL,
    defaultVoice = DEFAULT_VOICE,
    maxChunkLength = DEFAULT_MAX_CHUNK_LENGTH
} = {}) {
    return {
        async action(args) {
            let inputFile = args.inputFile;
            let outputFile = args.outputFile;

            validateInputFile(inputFile);

            let input = fileSystem.readFileSync(inputFile, 'utf8');
            let chunks = chunkText(input, maxChunkLength);
            let apiKey = await resolveApiKey({fs: fileSystem, localPaths: paths, prompt});
            let client = createOpenAI({apiKey});
            let voice = getDefaultVoice({fs: fileSystem, localPaths: paths, fallback: defaultVoice});
            let ffmpegPath = resolveFfmpegBinaryPath();
            let chunkDir = getChunkDirForOutput(outputFile);
            let chunkFiles = chunks.map((chunk, index) => getChunkFilePath(outputFile, index));

            ensureParentDir(outputFile);
            fileSystem.mkdirSync(chunkDir, {recursive: true});

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

                    fileSystem.writeFileSync(chunkFiles[index], Buffer.from(await response.arrayBuffer()));
                }
            } catch (error) {
                throw new Error(`${error.message}\nRetry with: ${getRetryCommand(inputFile, outputFile)}`);
            }

            await mergeChunks({chunkFiles, outputFile, ffmpegPath});
            cleanupChunkFiles(chunkFiles, {fs: fileSystem});
            return {outputFile};
        },
        async voiceAction(args, options = {}) {
            let voice = await resolveVoice({voice: options.voice || args.voice, fs: fileSystem, localPaths: paths, prompt});
            saveDefaultVoice(voice, {fs: fileSystem, localPaths: paths});
            return {voice};
        }
    };
}

let tts = createTtsService();

module.exports = Object.assign(tts, {
    createTtsService,
    readStoredApiKey,
    resolveApiKey,
    validateInputFile,
    getDefaultVoice,
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
