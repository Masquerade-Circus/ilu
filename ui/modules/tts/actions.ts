const fs = require('node:fs');
const path = require('node:path');
const tts = require('../../../tts');

const MISSING_CREDENTIALS = 'Set up Text to Speech before creating audio.';
const INVALID_INPUT = 'Choose a .txt or .md file.';
const CREATE_FAILED = 'Could not create audio.';
const SUPPORTED_INPUT_EXTENSIONS = new Set(['.txt', '.md']);

function cleanString(value: any, fallback: any = '') {
  return typeof value === 'string' ? value : fallback;
}

function callProgress(onProgress: any, message: any) {
  if (typeof onProgress === 'function') {
    onProgress(message);
  }
}

function isSupportedVoice(voice: any, voices: any) {
  return typeof voice === 'string' && voices.includes(voice);
}

function hasConfiguredCredentials(readStoredApiKey: any) {
  try {
    return cleanString(readStoredApiKey()).trim().length > 0;
  } catch (_: any) {
    return false;
  }
}

function isSupportedInputFile(inputFile: any, fileSystem: any) {
  const extension = path.extname(inputFile).toLowerCase();

  if (!SUPPORTED_INPUT_EXTENSIONS.has(extension)) {
    return false;
  }

  try {
    return fileSystem.existsSync(inputFile) && fileSystem.statSync(inputFile).isFile();
  } catch (_: any) {
    return false;
  }
}

function createTtsActions({
  service = tts.createTtsService(),
  readStoredApiKey = tts.readStoredApiKey,
  getDefaultVoice = tts.getDefaultVoice,
  voices = tts.SUPPORTED_VOICES,
  fs: fileSystem = fs
}: any = {}) {
  const supportedVoices = Array.isArray(voices) ? voices.filter((voice: any) => typeof voice === 'string' && voice.trim().length > 0) : [];
  const fallbackVoice = supportedVoices.includes('alloy') ? 'alloy' : supportedVoices[0] || 'alloy';

  function currentDefaultVoice() {
    try {
      const voice = cleanString(getDefaultVoice({fallback: fallbackVoice})).trim();
      return supportedVoices.includes(voice) ? voice : fallbackVoice;
    } catch (_: any) {
      return fallbackVoice;
    }
  }

  return {
    voices: supportedVoices,
    getDefaultVoice: currentDefaultVoice,
    async createAudio(values: any = {}) {
      const inputFile = cleanString(values.inputFile).trim();
      const outputFile = cleanString(values.outputFile).trim();
      const voice = cleanString(values.voice, currentDefaultVoice()).trim() || currentDefaultVoice();
      const onProgress = values.onProgress;

      if (!hasConfiguredCredentials(readStoredApiKey)) {
        return {ok: false, error: MISSING_CREDENTIALS};
      }

      callProgress(onProgress, 'Preparing file...');

      if (!isSupportedInputFile(inputFile, fileSystem)) {
        return {ok: false, error: INVALID_INPUT};
      }

      if (outputFile.length === 0) {
        return {ok: false, error: 'Output file is required.'};
      }

      if (!isSupportedVoice(voice, supportedVoices)) {
        return {ok: false, error: 'Choose a supported voice.'};
      }

      try {
        callProgress(onProgress, 'Creating audio...');
        const result = await service.action({inputFile, outputFile, voice});
        const finalOutputFile = cleanString(result && result.outputFile, outputFile);
        callProgress(onProgress, 'Audio ready.');
        return {ok: true, outputFile: finalOutputFile, message: 'Audio ready.'};
      } catch (_: any) {
        return {ok: false, error: CREATE_FAILED};
      }
    },
    async setDefaultVoice(values: any = {}) {
      const voice = cleanString(values.voice).trim();

      if (!isSupportedVoice(voice, supportedVoices)) {
        return {ok: false, error: 'Choose a supported voice.'};
      }

      try {
        const result = await service.voiceAction({voice}, {voice});
        return {ok: true, voice: cleanString(result && result.voice, voice)};
      } catch (_: any) {
        return {ok: false, error: 'Could not save the voice.'};
      }
    }
  };
}

module.exports = {
  createTtsActions
};
