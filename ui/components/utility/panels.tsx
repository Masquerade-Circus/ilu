import { Editor, FocusScope, Input, ScrollView, Text, View } from "@valyrianjs/terminal";
import type { TerminalEditorChangeEventPayload, TerminalInputChangeEventPayload } from "@valyrianjs/terminal";
import { createActionBar } from "../ActionBar";
import { createButton } from "../Button";
import type {
  BabelActions,
  OptionalTerminalChild,
  SyncActions,
  TerminalChild,
  TtsActions,
  UtilityRuntimeState
} from "../../types";
import {
  copyTranslation,
  invalidateBabelInput,
  prepareTtsVoiceOverlay,
  resetInitForm,
  runSyncOperation,
  runTranslate,
  runTtsConversion
} from "./operations";

type RequestRender = () => void;

function createSyncContent(state: UtilityRuntimeState, _syncActions: SyncActions, _onComplete?: RequestRender): JSX.Element {
  const busy = state.sync.operation !== null;

  return (
    <FocusScope>
      <Text>Sync</Text>
      {state.sync.error ? <Text>{state.sync.error}</Text> : <Text></Text>}
      <ScrollView id="sync-details-scroll" height={5}>
        {state.sync.details.map(detail => <Text>{detail}</Text>)}
        {busy ? <Text>Pending sync</Text> : <Text></Text>}
      </ScrollView>
    </FocusScope>
  );
}

export function createSyncActionBar(state: UtilityRuntimeState, syncActions: SyncActions, onComplete?: RequestRender): OptionalTerminalChild {
  return createActionBar({
    actions: [
      createButton("sync-retry", "Retry sync", () => runSyncOperation(state, "retry", () => syncActions.retry(), onComplete)),
      createButton("sync-enable", "Enable sync", () => runSyncOperation(state, "enable", () => syncActions.enable(), onComplete)),
      createButton("sync-disable", "Disable sync", () => runSyncOperation(state, "disable", () => syncActions.disable(), onComplete)),
      createButton("sync-setup", "Set up sync", () => {
        resetInitForm(state);
        state.activeOverlay = "sync-init";
      })
    ]
  });
}

export function createTranslateActionBar(state: UtilityRuntimeState, babelActions: BabelActions, onComplete?: RequestRender): OptionalTerminalChild {
  return createActionBar({
    actions: [
      createButton("translate-start", "Translate", () => runTranslate(state, babelActions, onComplete)),
      createButton("translate-copy", "Copy result", () => copyTranslation(state, babelActions, onComplete))
    ]
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

function createTtsContent(state: UtilityRuntimeState, _ttsActions: TtsActions, _onComplete?: RequestRender): JSX.Element {
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
    </FocusScope>
  );
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
