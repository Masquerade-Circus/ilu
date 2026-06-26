import { FocusScope, Input, List, Spinner, Text } from "@valyrianjs/terminal";
import type { TerminalInputChangeEventPayload, TerminalListPressEventPayload } from "@valyrianjs/terminal";
import { createActionBar } from "../../components/ActionBar";
import { createButton } from "../../components/Button";
import { AppOverlay } from "../../components/Overlay";
import type { OptionalTerminalChild, TerminalChild, TtsActionResult, TtsActions, TtsUtilityState, UtilityRuntimeState } from "../../types";
import { cleanStringArray, cleanText } from "../../components/utility/text";

type RequestRender = () => void;
type TtsOverlayLayout = {
  width: number;
  rows: number;
};

const TTS_FAILURE: TtsActionResult = Object.freeze({ ok: false, error: "Could not create audio." });
export const DEFAULT_VOICES = Object.freeze(["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"] as const);

export function createInitialTtsState(source: Record<string, unknown> = {}): TtsUtilityState {
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

export function clearTtsUtilityTransientState(state: UtilityRuntimeState): void {
  state.tts.error = "";
  state.tts.message = "";
}

function requiredText(value: string): string {
  return value.trim();
}

function updateTtsVoices(state: UtilityRuntimeState, ttsActions: TtsActions, preferStoredVoice: boolean = false): void {
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

export function prepareTtsViewState(state: UtilityRuntimeState, ttsActions: TtsActions): void {
  updateTtsVoices(state, ttsActions, true);
}

export function prepareTtsVoiceOverlay(state: UtilityRuntimeState, ttsActions: TtsActions): void {
  updateTtsVoices(state, ttsActions);
  state.activeOverlay = "tts-voice";
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
    .then((result) => {
      const safeResult = result || TTS_FAILURE;

      if (safeResult.ok === true) {
        state.tts.error = "";
        state.tts.message = cleanText(safeResult.message, "Audio ready.");
        return;
      }

      state.tts.error = cleanText(safeResult.error, "Could not create audio.");
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
    .then((result) => {
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

export function createTtsActionBar(state: UtilityRuntimeState, ttsActions: TtsActions, onComplete?: RequestRender): OptionalTerminalChild {
  return createActionBar({
    actions: [
      createButton("tts-start", "Start conversion", () => runTtsConversion(state, ttsActions, onComplete)),
      createButton("tts-choose-voice", "Choose voice", () => {
        prepareTtsVoiceOverlay(state, ttsActions);
      })
    ]
  });
}

export function createTtsMainView(state: UtilityRuntimeState, _ttsActions: TtsActions, _onComplete?: RequestRender): TerminalChild[] {
  const busy = state.tts.operation !== null;

  return [
    <FocusScope>
      <Text>Text to Speech</Text>
      <Text>Create audio</Text>
      {busy ? <Spinner frame={1} label="Audio in progress" /> : <Text></Text>}
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
    </FocusScope>
  ];
}

export function createTtsVoiceOverlay(state: UtilityRuntimeState, ttsActions: TtsActions, layout: TtsOverlayLayout, onComplete?: RequestRender): OptionalTerminalChild {
  if (state.activeOverlay !== "tts-voice") {
    return null;
  }

  return (
    <AppOverlay
      trapFocus={true}
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
            height={Math.max(1, layout.rows - 8)}
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
