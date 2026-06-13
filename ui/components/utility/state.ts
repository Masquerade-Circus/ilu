import type {
  BabelUtilityState,
  SyncUtilityState,
  TtsUtilityState,
  UtilityOverlayId,
  UtilityRuntimeState
} from "../../types";

export const DEFAULT_SYNC_DETAILS = Object.freeze(["Status: Not set up"] as const);
export const DEFAULT_VOICES = Object.freeze(["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"] as const);

export function cleanText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function cleanStringArray(value: unknown, fallback: readonly string[] = []): string[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const values = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map(item => item.trim());
  return values.length > 0 ? values : [...fallback];
}

export function cleanDetails(value: unknown): string[] {
  const details = cleanStringArray(value, DEFAULT_SYNC_DETAILS);
  return details.length > 0 ? details : [...DEFAULT_SYNC_DETAILS];
}

function isUtilityOverlayId(value: unknown): value is Exclude<UtilityOverlayId, null> {
  return value === "sync-init" || value === "tts-voice";
}

function createInitialSyncState(source: Record<string, unknown> = {}): SyncUtilityState {
  const syncSource = typeof source.sync === "object" && source.sync !== null ? source.sync as Record<string, unknown> : {};
  const formSource = typeof syncSource.initForm === "object" && syncSource.initForm !== null ? syncSource.initForm as Record<string, unknown> : {};

  return {
    label: cleanText(syncSource.label, "Not set up"),
    details: cleanDetails(syncSource.details),
    error: cleanText(syncSource.error),
    operation: typeof syncSource.operation === "string" ? syncSource.operation : null,
    statusLoaded: syncSource.statusLoaded === true,
    initForm: {
      remoteUrl: cleanText(formSource.remoteUrl),
      branch: cleanText(formSource.branch, "main"),
      confirmed: formSource.confirmed === true,
      error: cleanText(formSource.error)
    }
  };
}

function createInitialBabelState(source: Record<string, unknown> = {}): BabelUtilityState {
  const babelSource = typeof source.babel === "object" && source.babel !== null ? source.babel as Record<string, unknown> : {};

  return {
    text: cleanText(babelSource.text),
    source: cleanText(babelSource.source, "auto"),
    target: cleanText(babelSource.target, "en"),
    translation: cleanText(babelSource.translation),
    dictionaryEntries: cleanStringArray(babelSource.dictionaryEntries),
    error: cleanText(babelSource.error),
    message: cleanText(babelSource.message),
    operation: typeof babelSource.operation === "string" ? babelSource.operation : null,
    inputVersion: typeof babelSource.inputVersion === "number" && Number.isFinite(babelSource.inputVersion)
      ? babelSource.inputVersion
      : 0
  };
}

function createInitialTtsState(source: Record<string, unknown> = {}): TtsUtilityState {
  const ttsSource = typeof source.tts === "object" && source.tts !== null ? source.tts as Record<string, unknown> : {};
  const voices = cleanStringArray(ttsSource.voices, DEFAULT_VOICES);
  const voice = cleanText(ttsSource.voice, voices.includes("alloy") ? "alloy" : voices[0] || "alloy");

  return {
    inputFile: cleanText(ttsSource.inputFile),
    outputFile: cleanText(ttsSource.outputFile),
    voice,
    voices,
    error: cleanText(ttsSource.error),
    message: cleanText(ttsSource.message),
    operation: typeof ttsSource.operation === "string" ? ttsSource.operation : null
  };
}

export function createInitialUtilityState(source: Record<string, unknown> = {}): UtilityRuntimeState {
  const activeOverlay = isUtilityOverlayId(source.activeOverlay) ? source.activeOverlay : null;

  return {
    activeOverlay,
    sync: createInitialSyncState(source),
    babel: createInitialBabelState(source),
    tts: createInitialTtsState(source)
  };
}

export function hasActiveUtilityOverlay(state: UtilityRuntimeState): boolean {
  return state.activeOverlay !== null;
}
