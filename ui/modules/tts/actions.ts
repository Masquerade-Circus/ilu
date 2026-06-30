import type { TtsActionFactoryOptions, TtsActions } from "../../action-contracts";

import fs from 'node:fs';
import path from 'node:path';
import tts from '../../../tts';
const MISSING_CREDENTIALS = 'Set up Text to Speech before creating audio.';
const INVALID_INPUT = 'Choose a .txt or .md file.';
const CREATE_FAILED = 'Could not create audio.';
const SUPPORTED_INPUT_EXTENSIONS = new Set(['.txt', '.md']);

type TtsValues = {inputFile?: unknown; outputFile?: unknown; voice?: unknown; onProgress?: unknown};
type ProgressCallback = (message: string) => void;
type TtsResult = {outputFile?: unknown; voice?: unknown};
type FileSystem = {
  existsSync: (path: string) => boolean;
  statSync: (path: string) => {isFile: () => boolean};
};

function cleanString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function callProgress(onProgress: unknown, message: string) {
  if (typeof onProgress === 'function') {
    (onProgress as ProgressCallback)(message);
  }
}

function isSupportedVoice(voice: unknown, voices: string[]) {
  return typeof voice === 'string' && voices.includes(voice);
}

function hasConfiguredCredentials(readStoredApiKey: () => unknown) {
  try {
    return cleanString(readStoredApiKey()).trim().length > 0;
  } catch (_error: unknown) {
    void _error;
    return false;
  }
}

function isSupportedInputFile(inputFile: string, fileSystem: FileSystem) {
  const extension = path.extname(inputFile).toLowerCase();

  if (!SUPPORTED_INPUT_EXTENSIONS.has(extension)) {
    return false;
  }

  try {
    return fileSystem.existsSync(inputFile) && fileSystem.statSync(inputFile).isFile();
  } catch (_error: unknown) {
    void _error;
    return false;
  }
}

function createTtsActions({
  service = tts.createTtsService(),
  readStoredApiKey = tts.readStoredApiKey,
  getDefaultVoice = tts.getDefaultVoice,
  voices = tts.SUPPORTED_VOICES,
  fs: fileSystem = fs
}: TtsActionFactoryOptions = {}): TtsActions {
  const supportedVoices = Array.isArray(voices) ? voices.filter((voice: unknown): voice is string => typeof voice === 'string' && voice.trim().length > 0) : [];
  const fallbackVoice = supportedVoices.includes('alloy') ? 'alloy' : supportedVoices[0] || 'alloy';

  function currentDefaultVoice() {
    try {
      const voice = cleanString(getDefaultVoice({fallback: fallbackVoice})).trim();
      return supportedVoices.includes(voice) ? voice : fallbackVoice;
    } catch (_error: unknown) {
      void _error;
      return fallbackVoice;
    }
  }

  return {
    voices: supportedVoices,
    getDefaultVoice: currentDefaultVoice,
    async createAudio(values: TtsValues = {}) {
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
        const result = await service.action({inputFile, outputFile, voice}) as TtsResult;
        const finalOutputFile = cleanString(result && result.outputFile, outputFile);
        callProgress(onProgress, 'Audio ready.');
        return {ok: true, outputFile: finalOutputFile, message: 'Audio ready.'};
      } catch (_error: unknown) {
        void _error;
        return {ok: false, error: CREATE_FAILED};
      }
    },
    async setDefaultVoice(values: TtsValues = {}) {
      const voice = cleanString(values.voice).trim();

      if (!isSupportedVoice(voice, supportedVoices)) {
        return {ok: false, error: 'Choose a supported voice.'};
      }

      try {
        const result = await service.voiceAction({voice}, {voice}) as TtsResult;
        return {ok: true, voice: cleanString(result && result.voice, voice)};
      } catch (_error: unknown) {
        void _error;
        return {ok: false, error: 'Could not save the voice.'};
      }
    }
  };
}

export { createTtsActions };
export default {
  createTtsActions
};
