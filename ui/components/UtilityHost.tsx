import { Editor, FocusScope, Input, List, ScrollView, Text, View } from "@valyrianjs/terminal";
import type { TerminalEditorChangeEventPayload, TerminalInputChangeEventPayload, TerminalListPressEventPayload } from "@valyrianjs/terminal";
import { createButton } from "./Button";
import { AppOverlay, overlayInnerDimension } from "./Overlay";
import type {
  BabelActions,
  BabelActionResult,
  BabelUtilityState,
  OptionalTerminalChild,
  SyncActions,
  SyncActionResult,
  SyncUtilityState,
  TerminalChild,
  TtsActions,
  TtsActionResult,
  TtsUtilityState,
  UtilityOverlayId,
  UtilityRuntimeState
} from "../types";

const DEFAULT_SYNC_DETAILS = Object.freeze(["Status: Not set up"] as const);
const FAILURE_RESULT: SyncActionResult = Object.freeze({
  ok: false,
  error: "Sync failed. Check your setup and try again.",
  label: "Sync failed",
  details: ["Status: Sync failed"]
});
const DEFAULT_VOICES = Object.freeze(["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"] as const);
const TTS_FAILURE: TtsActionResult = Object.freeze({ ok: false, error: "Could not create audio." });
const BABEL_FAILURE: BabelActionResult = Object.freeze({ ok: false, error: "Could not translate the text." });

type RequestRender = () => void;

type UtilityOverlayLayout = {
  width: number;
  rows: number;
};

type SyncOperation = "status" | "retry" | "enable" | "disable" | "init";

function cleanText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function cleanStringArray(value: unknown, fallback: readonly string[] = []): string[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const values = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map(item => item.trim());
  return values.length > 0 ? values : [...fallback];
}

function cleanDetails(value: unknown): string[] {
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

function runSyncOperation(
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

function resetInitForm(state: UtilityRuntimeState): void {
  state.sync.initForm.remoteUrl = "";
  state.sync.initForm.branch = "main";
  state.sync.initForm.confirmed = false;
  state.sync.initForm.error = "";
  state.sync.error = "";
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

function invalidateBabelInput(state: BabelUtilityState): void {
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

function runTranslate(state: UtilityRuntimeState, babelActions: BabelActions, onComplete: RequestRender = () => {}): void {
  if (state.babel.operation !== null) {
    return;
  }

  state.babel.operation = "translate";
  state.babel.error = "";
  state.babel.message = "";
  clearBabelResult(state.babel);

  const requestVersion = state.babel.inputVersion;
  const requestValues = { text: state.babel.text, source: state.babel.source, target: state.babel.target };

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

function copyTranslation(state: UtilityRuntimeState, babelActions: BabelActions, onComplete: RequestRender = () => {}): void {
  if (state.babel.operation !== null) {
    return;
  }

  state.babel.operation = "copy";
  state.babel.error = "";
  state.babel.message = "";

  Promise.resolve(babelActions.copyResult({ translation: state.babel.translation }))
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

function runTtsConversion(state: UtilityRuntimeState, ttsActions: TtsActions, onComplete: RequestRender = () => {}): void {
  if (state.tts.operation !== null) {
    return;
  }

  state.tts.operation = "create-audio";
  state.tts.error = "";
  state.tts.message = "Preparing file...";

  Promise.resolve(ttsActions.createAudio({
    inputFile: state.tts.inputFile,
    outputFile: state.tts.outputFile,
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

function setTtsVoice(state: UtilityRuntimeState, ttsActions: TtsActions, voice: string, onComplete: RequestRender = () => {}): void {
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

function createSyncContent(state: UtilityRuntimeState, syncActions: SyncActions, onComplete?: RequestRender): JSX.Element {
  ensureSyncStatus(state, syncActions, onComplete);
  const busy = state.sync.operation !== null;

  return (
    <FocusScope>
      <Text>Sync</Text>
      {state.sync.error ? <Text>{state.sync.error}</Text> : <Text></Text>}
      <ScrollView id="sync-details-scroll" height={5}>
        {state.sync.details.map(detail => <Text>{detail}</Text>)}
        {busy ? <Text>Pending sync</Text> : <Text></Text>}
      </ScrollView>
      <View direction="row" gap={1}>
        {createButton("sync-retry", "Retry sync", () => runSyncOperation(state, "retry", () => syncActions.retry(), onComplete))}
        {createButton("sync-enable", "Enable sync", () => runSyncOperation(state, "enable", () => syncActions.enable(), onComplete))}
        {createButton("sync-disable", "Disable sync", () => runSyncOperation(state, "disable", () => syncActions.disable(), onComplete))}
      </View>
      <View direction="row" gap={1}>
        {createButton("sync-setup", "Set up sync", () => {
          resetInitForm(state);
          state.activeOverlay = "sync-init";
        })}
      </View>
    </FocusScope>
  );
}

function createSyncInitOverlay(state: UtilityRuntimeState, syncActions: SyncActions, layout: UtilityOverlayLayout, onComplete?: RequestRender): OptionalTerminalChild {
  if (state.activeOverlay !== "sync-init") {
    return null;
  }

  const form = state.sync.initForm;

  function startSync(): void {
    form.error = "";

    if (form.remoteUrl.trim().length === 0) {
      form.error = "Remote URL is required.";
      return;
    }

    if (form.branch.trim().length === 0) {
      form.error = "Branch is required.";
      return;
    }

    if (form.confirmed !== true) {
      form.error = "Confirm setup before starting sync.";
      return;
    }

    runSyncOperation(state, "init", () => syncActions.init({
      remoteUrl: form.remoteUrl,
      branch: form.branch,
      confirmed: form.confirmed
    }), () => {
      if (state.sync.error.length === 0) {
        state.activeOverlay = null;
      } else {
        form.error = state.sync.error;
      }

      if (typeof onComplete === "function") {
        onComplete();
      }
    });

    if (state.sync.error.length > 0) {
      form.error = state.sync.error;
    }

    if (state.sync.operation === null && state.sync.error.length === 0) {
      state.activeOverlay = null;
    }
  }

  return (
    <AppOverlay
      trapFocus={true}
      width={overlayInnerDimension(layout.width)}
      height={overlayInnerDimension(layout.rows)}
      title={<Text>Sync</Text>}
      content={
        <FocusScope>
          {form.error ? <Text>{form.error}</Text> : <Text></Text>}
          <Text>Remote URL</Text>
          <Input
            id="sync-init-remote"
            value={form.remoteUrl}
            placeholder="Remote URL"
            onchange={(event: TerminalInputChangeEventPayload) => {
              form.remoteUrl = event.value;
              form.error = "";
              state.sync.error = "";
            }}
          />
          <Text>Branch</Text>
          <Input
            id="sync-init-branch"
            value={form.branch}
            placeholder="Branch"
            onchange={(event: TerminalInputChangeEventPayload) => {
              form.branch = event.value;
              form.error = "";
              state.sync.error = "";
            }}
          />
          <Text>Start sync with this remote and branch?</Text>
          <Text>If this device and the remote already contain data,</Text>
          <Text>setup may stop to protect your files.</Text>
        </FocusScope>
      }
      bottomNav={
        <View direction="row" gap={1}>
          {createButton("sync-init-confirm", form.confirmed ? "Confirmed" : "Confirm setup", () => {
            form.confirmed = !form.confirmed;
            form.error = "";
          })}
          {createButton("sync-init-start", "Set up sync", startSync)}
          {createButton("sync-init-cancel", "Cancel", () => {
            state.activeOverlay = null;
            form.error = "";
          })}
        </View>
      }
    />
  ) as TerminalChild;
}

function createTranslateContent(state: UtilityRuntimeState, babelActions: BabelActions, onComplete?: RequestRender): JSX.Element {
  return (
    <FocusScope>
          <Text>Translate</Text>
          {state.babel.error ? <Text>{state.babel.error}</Text> : <Text></Text>}
          {state.babel.message ? <Text>{state.babel.message}</Text> : <Text></Text>}
          <Text>Text to translate</Text>
          <Editor
            id="translate-text"
            value={state.babel.text}
            height={3}
            placeholder="Text to translate"
            onchange={(event: TerminalEditorChangeEventPayload) => {
              state.babel.text = event.value;
              invalidateBabelInput(state.babel);
            }}
          />
          <View direction="row" gap={1}>
            <Text>From</Text>
            <Input
              id="translate-from"
              value={state.babel.source}
              placeholder="From"
              onchange={(event: TerminalInputChangeEventPayload) => {
                state.babel.source = event.value;
                invalidateBabelInput(state.babel);
              }}
            />
            <Text>To</Text>
            <Input
              id="translate-to"
              value={state.babel.target}
              placeholder="To"
              onchange={(event: TerminalInputChangeEventPayload) => {
                state.babel.target = event.value;
                invalidateBabelInput(state.babel);
              }}
            />
          </View>
          <View direction="row" gap={1}>
            {createButton("translate-start", "Translate", () => runTranslate(state, babelActions, onComplete))}
            {createButton("translate-copy", "Copy result", () => copyTranslation(state, babelActions, onComplete))}

          </View>
          <ScrollView id="translate-result-scroll" height={6}>
            <Text>Translation</Text>
            <Text>{state.babel.translation || ""}</Text>
            <Text>Dictionary</Text>
            {state.babel.dictionaryEntries.length > 0
              ? state.babel.dictionaryEntries.map(entry => <Text>{entry}</Text>)
              : <Text>No dictionary entries found.</Text>}
          </ScrollView>
    </FocusScope>
  );
}

function createTtsContent(state: UtilityRuntimeState, ttsActions: TtsActions, onComplete?: RequestRender): JSX.Element {
  updateTtsVoices(state, ttsActions);

  return (
    <FocusScope>
          <Text>Text to Speech</Text>
          <Text>Create audio</Text>
          {state.tts.error ? <Text>{state.tts.error}</Text> : <Text></Text>}
          {state.tts.message ? <Text>{state.tts.message}</Text> : <Text></Text>}
          <Text>Input file</Text>
          <Input
            id="tts-input-file"
            value={state.tts.inputFile}
            placeholder="Input file"
            onchange={(event: TerminalInputChangeEventPayload) => {
              state.tts.inputFile = event.value;
              state.tts.error = "";
            }}
          />
          <Text>Output file</Text>
          <Input
            id="tts-output-file"
            value={state.tts.outputFile}
            placeholder="Output file"
            onchange={(event: TerminalInputChangeEventPayload) => {
              state.tts.outputFile = event.value;
              state.tts.error = "";
            }}
          />
          <Text>Voice</Text>
          <Text>{state.tts.voice}</Text>
          <View direction="row" gap={1}>
            {createButton("tts-start", "Start conversion", () => runTtsConversion(state, ttsActions, onComplete))}
            {createButton("tts-choose-voice", "Choose voice", () => {
              updateTtsVoices(state, ttsActions);
              state.activeOverlay = "tts-voice";
            })}

          </View>
    </FocusScope>
  );
}

function createTtsVoiceOverlay(state: UtilityRuntimeState, ttsActions: TtsActions, layout: UtilityOverlayLayout, onComplete?: RequestRender): OptionalTerminalChild {
  if (state.activeOverlay !== "tts-voice") {
    return null;
  }

  updateTtsVoices(state, ttsActions);

  return (
    <AppOverlay
      trapFocus={true}
      width={overlayInnerDimension(layout.width)}
      height={overlayInnerDimension(layout.rows)}
      title={<Text>Choose voice</Text>}
      content={
        <FocusScope>
          {state.tts.error ? <Text>{state.tts.error}</Text> : <Text></Text>}
          <List
            id="tts-voice-list"
            items={state.tts.voices}
            itemKey={(item: string) => item}
            showActive={true}
            virtualized={true}
            height={Math.max(1, overlayInnerDimension(layout.rows) - 4)}
            wrap={true}
            onpress={(event: TerminalListPressEventPayload<string>) => setTtsVoice(state, ttsActions, event.value, onComplete)}
          >
            {(voice: string) => `${voice === state.tts.voice ? "✓" : "•"} ${voice}`}
          </List>
        </FocusScope>
      }
      bottomNav={
        createButton("tts-voice-cancel", "Cancel", () => {
          state.activeOverlay = null;
          state.tts.error = "";
        })
      }
    />
  ) as TerminalChild;
}

export function createUtilityPanel(
  activeApp: string,
  state: UtilityRuntimeState,
  syncActions: SyncActions,
  babelActions: BabelActions,
  ttsActions: TtsActions,
  onComplete?: RequestRender
): TerminalChild[] {
  if (activeApp === "Sync") {
    return [createSyncContent(state, syncActions, onComplete)];
  }

  if (activeApp === "Translate") {
    return [createTranslateContent(state, babelActions, onComplete)];
  }

  if (activeApp === "Speech") {
    return [createTtsContent(state, ttsActions, onComplete)];
  }

  return [];
}

export function createUtilityOverlay(
  state: UtilityRuntimeState,
  syncActions: SyncActions,
  _babelActions: BabelActions,
  ttsActions: TtsActions,
  layout: UtilityOverlayLayout,
  onComplete?: RequestRender
): OptionalTerminalChild {
  return createSyncInitOverlay(state, syncActions, layout, onComplete)
    ?? createTtsVoiceOverlay(state, ttsActions, layout, onComplete);
}
