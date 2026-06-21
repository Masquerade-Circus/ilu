import type {
  BabelActions,
  BabelActionResult,
  BabelUtilityState,
  SyncActions,
  SyncActionResult,
  SyncUtilityState,
  TtsActions,
  TtsActionResult,
  TtsUtilityState,
  UtilityRuntimeState
} from "../../types";
import {
  DEFAULT_SYNC_DETAILS,
  DEFAULT_VOICES,
  cleanDetails,
  cleanStringArray,
  cleanText,
  hasActiveUtilityOverlay
} from "./state";

type RequestRender = () => void;
type CopyText = (text: string) => BabelActionResult | Promise<BabelActionResult>;
type SyncOperation = "status" | "retry" | "enable" | "disable" | "init";

const FAILURE_RESULT: SyncActionResult = Object.freeze({
  ok: false,
  error: "Sync failed. Check your setup and try again.",
  label: "Sync failed",
  details: ["Status: Sync failed"]
});
const TTS_FAILURE: TtsActionResult = Object.freeze({ ok: false, error: "Could not create audio." });
const BABEL_FAILURE: BabelActionResult = Object.freeze({ ok: false, error: "Could not translate the text." });

export function closeUtilityOverlay(state: UtilityRuntimeState): boolean {
  if (!hasActiveUtilityOverlay(state)) {
    return false;
  }

  state.activeOverlay = null;
  state.sync.error = "";
  state.sync.initForm.error = "";
  state.babel.error = "";
  state.babel.message = "";
  state.tts.error = "";
  state.tts.message = "";
  return true;
}

function applySyncResult(state: SyncUtilityState, result: SyncActionResult | undefined): void {
  const safeResult = result || FAILURE_RESULT;
  const label = cleanText(safeResult.label, safeResult.ok === true ? "Synced" : "Sync failed");

  state.label = label;
  state.details = cleanDetails(safeResult.details ?? [`Status: ${label}`]);
  state.error = safeResult.ok === false && typeof safeResult.error === "string" ? safeResult.error : "";
  state.statusLoaded = true;
}

export function runSyncOperation(
  state: UtilityRuntimeState,
  operation: SyncOperation,
  action: () => SyncActionResult | Promise<SyncActionResult>,
  onComplete: RequestRender = () => {}
): void {
  if (state.sync.operation !== null) {
    return;
  }

  state.sync.operation = operation;
  state.sync.error = "";

  try {
    const result = action();

    if (result && typeof result === "object" && "then" in result && typeof result.then === "function") {
      Promise.resolve(result)
        .then((resolved) => {
          applySyncResult(state.sync, resolved);
        })
        .catch(() => {
          applySyncResult(state.sync, FAILURE_RESULT);
        })
        .finally(() => {
          state.sync.operation = null;
          onComplete();
        });
      return;
    }

    applySyncResult(state.sync, result as SyncActionResult);
  } catch (_) {
    applySyncResult(state.sync, FAILURE_RESULT);
  }

  state.sync.operation = null;
}

function ensureSyncStatus(state: UtilityRuntimeState, syncActions: SyncActions, onComplete?: RequestRender): void {
  if (state.sync.statusLoaded || state.sync.operation !== null) {
    return;
  }

  runSyncOperation(state, "status", () => syncActions.status(), onComplete);
}

export function prepareUtilityApp(state: UtilityRuntimeState, app: string, syncActions: SyncActions, ttsActions: TtsActions, onComplete?: RequestRender): void {
  state.activeOverlay = null;

  if (app === "Sync") {
    ensureSyncStatus(state, syncActions, onComplete);
    return;
  }

  if (app === "Speech") {
    updateTtsVoices(state, ttsActions, true);
  }
}

export function resetInitForm(state: UtilityRuntimeState): void {
  state.sync.initForm.remoteUrl = "";
  state.sync.initForm.branch = "main";
  state.sync.initForm.confirmed = false;
  state.sync.initForm.error = "";
  state.sync.error = "";
}

export function prepareTtsVoiceOverlay(state: UtilityRuntimeState, ttsActions: TtsActions): void {
  updateTtsVoices(state, ttsActions);
  state.activeOverlay = "tts-voice";
}

function updateTtsVoices(state: UtilityRuntimeState, ttsActions: TtsActions, preferStoredVoice = false): void {
  const voices = cleanStringArray(ttsActions.voices, DEFAULT_VOICES);
  state.tts.voices = voices;

  if (!preferStoredVoice && voices.includes(state.tts.voice)) {
    return;
  }

  if (typeof ttsActions.getDefaultVoice === "function") {
    const defaultVoice = cleanText(ttsActions.getDefaultVoice()).trim();

    if (voices.includes(defaultVoice)) {
      state.tts.voice = defaultVoice;
      return;
    }
  }

  state.tts.voice = voices.includes("alloy") ? "alloy" : voices[0] || "alloy";
}

function clearBabelResult(state: BabelUtilityState): void {
  state.translation = "";
  state.dictionaryEntries = [];
}

function requiredText(value: string): string {
  return value.trim();
}

function hasEmbeddedUrlUserinfo(value: string): boolean {
  try {
    const parsedUrl = new URL(value);

    return parsedUrl.username.length > 0 || parsedUrl.password.length > 0;
  } catch {
    return false;
  }
}

export function validateSyncInitForm(form: SyncUtilityState["initForm"]): string {
  const remoteUrl = requiredText(form.remoteUrl);
  const branch = requiredText(form.branch);

  if (remoteUrl.length === 0) {
    return "Remote URL is required.";
  }

  if (hasEmbeddedUrlUserinfo(remoteUrl)) {
    return "Remote URL must not include embedded credentials.";
  }

  if (branch.length === 0) {
    return "Branch is required.";
  }

  if (form.confirmed !== true) {
    return "Confirm setup before starting sync.";
  }

  return "";
}

export function validateTranslateInput(state: BabelUtilityState): string {
  if (requiredText(state.text).length === 0) {
    return "Text to translate is required.";
  }

  if (requiredText(state.source).length === 0) {
    return "Source language is required.";
  }

  if (requiredText(state.target).length === 0) {
    return "Target language is required.";
  }

  return "";
}

export function validateTtsInput(state: TtsUtilityState): string {
  if (requiredText(state.inputFile).length === 0) {
    return "Input file is required.";
  }

  if (requiredText(state.outputFile).length === 0) {
    return "Output file is required.";
  }

  return "";
}

export function invalidateBabelInput(state: BabelUtilityState): void {
  state.inputVersion += 1;
  state.error = "";
  state.message = "";
  clearBabelResult(state);
}

function applyBabelResult(state: BabelUtilityState, result: BabelActionResult | undefined): void {
  const safeResult = result || BABEL_FAILURE;

  if (safeResult.ok === true) {
    state.translation = cleanText(safeResult.translation);
    state.dictionaryEntries = cleanStringArray(safeResult.dictionaryEntries);
    state.error = "";
    state.message = cleanText(safeResult.message);
    return;
  }

  clearBabelResult(state);
  state.error = cleanText(safeResult.error, "Could not translate the text.");
  state.message = "";
}

export function runTranslate(state: UtilityRuntimeState, babelActions: BabelActions, onComplete: RequestRender = () => {}): void {
  if (state.babel.operation !== null) {
    return;
  }

  const validationError = validateTranslateInput(state.babel);

  if (validationError.length > 0) {
    clearBabelResult(state.babel);
    state.babel.error = validationError;
    state.babel.message = "";
    return;
  }

  state.babel.operation = "translate";
  state.babel.error = "";
  state.babel.message = "";
  clearBabelResult(state.babel);

  const requestVersion = state.babel.inputVersion;
  const requestValues = { text: state.babel.text.trim(), source: state.babel.source.trim(), target: state.babel.target.trim() };

  Promise.resolve(babelActions.translate(requestValues))
    .then(result => {
      if (state.babel.inputVersion !== requestVersion) {
        return;
      }

      applyBabelResult(state.babel, result);
    })
    .catch(() => {
      if (state.babel.inputVersion !== requestVersion) {
        return;
      }

      applyBabelResult(state.babel, BABEL_FAILURE);
    })
    .finally(() => {
      state.babel.operation = null;
      onComplete();
    });
}

export function copyTranslation(state: UtilityRuntimeState, copyText: CopyText, onComplete: RequestRender = () => {}): void {
  if (state.babel.operation !== null) {
    return;
  }

  state.babel.operation = "copy";
  state.babel.error = "";
  state.babel.message = "";

  Promise.resolve(copyText(state.babel.translation))
    .then(result => {
      if (result.ok === true) {
        state.babel.message = cleanText(result.message, "Copied.");
        return;
      }

      state.babel.error = cleanText(result.error, "Could not copy the translation.");
    })
    .catch(() => {
      state.babel.error = "Could not copy the translation.";
    })
    .finally(() => {
      state.babel.operation = null;
      onComplete();
    });
}

export function runTtsConversion(state: UtilityRuntimeState, ttsActions: TtsActions, onComplete: RequestRender = () => {}): void {
  if (state.tts.operation !== null) {
    return;
  }

  const validationError = validateTtsInput(state.tts);

  if (validationError.length > 0) {
    state.tts.error = validationError;
    state.tts.message = "";
    return;
  }

  state.tts.operation = "create-audio";
  state.tts.error = "";
  state.tts.message = "Preparing file...";

  Promise.resolve(ttsActions.createAudio({
    inputFile: state.tts.inputFile.trim(),
    outputFile: state.tts.outputFile.trim(),
    voice: state.tts.voice,
    onProgress(message: string) {
      state.tts.message = cleanText(message, "Creating audio...");
      onComplete();
    }
  }))
    .then(result => {
      if (result.ok === true) {
        state.tts.error = "";
        state.tts.message = cleanText(result.message, "Audio ready.");
        return;
      }

      state.tts.error = cleanText(result.error, "Could not create audio.");
      state.tts.message = "";
    })
    .catch(() => {
      state.tts.error = "Could not create audio.";
      state.tts.message = "";
    })
    .finally(() => {
      state.tts.operation = null;
      onComplete();
    });
}

export function setTtsVoice(state: UtilityRuntimeState, ttsActions: TtsActions, voice: string, onComplete: RequestRender = () => {}): void {
  if (state.tts.operation !== null) {
    return;
  }

  state.tts.operation = "voice";
  state.tts.error = "";
  state.tts.message = "";

  Promise.resolve(ttsActions.setDefaultVoice({ voice }))
    .then(result => {
      if (result.ok === true) {
        state.tts.voice = cleanText(result.voice, voice);
        state.tts.message = "Voice saved.";
        state.activeOverlay = null;
        return;
      }

      state.tts.error = cleanText(result.error, "Choose a supported voice.");
    })
    .catch(() => {
      state.tts.error = "Choose a supported voice.";
    })
    .finally(() => {
      state.tts.operation = null;
      onComplete();
    });
}
