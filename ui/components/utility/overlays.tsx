import { FocusScope, Input, List, Text, View } from "@valyrianjs/terminal";
import type { TerminalInputChangeEventPayload, TerminalListPressEventPayload } from "@valyrianjs/terminal";
import { createButton } from "../Button";
import { AppOverlay } from "../Overlay";
import type {
  BabelActions,
  OptionalTerminalChild,
  SyncActions,
  TerminalChild,
  TtsActions,
  UtilityRuntimeState
} from "../../types";
import { runSyncOperation, setTtsVoice } from "./operations";

type RequestRender = () => void;

type UtilityOverlayLayout = {
  width: number;
  rows: number;
};

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

function createTtsVoiceOverlay(state: UtilityRuntimeState, ttsActions: TtsActions, layout: UtilityOverlayLayout, onComplete?: RequestRender): OptionalTerminalChild {
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
