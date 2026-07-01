import { FocusScope, Input, LogView, Spinner, Text, View } from "@valyrianjs/terminal";
import type { TerminalInputChangeEventPayload } from "@valyrianjs/terminal";
import { createActionBar } from "../../components/ActionBar";
import { createButton } from "../../components/Button";
import { AppOverlay } from "../../components/Overlay";
import type { OptionalTerminalChild, SyncActionResult, SyncActions, SyncUtilityState, TerminalChild, UtilityAppState } from "../../types";
import { cleanStringArray, cleanText } from "../../components/utility/text";
import { hasEmbeddedUrlUserinfo } from "../../../sync/remote-validation";

type RequestRender = () => void;
type SyncOperation = "status" | "retry" | "enable" | "disable" | "init";
type SyncOverlayLayout = {
  width: number;
  rows: number;
};

const FAILURE_RESULT: SyncActionResult = Object.freeze({
  ok: false,
  error: "Sync failed. Check your setup and try again.",
  label: "Sync failed",
  details: ["Status: Sync failed"]
});
const DEFAULT_SYNC_DETAILS = Object.freeze(["Status: Not set up"] as const);
const syncOperationTokens = new WeakMap<SyncUtilityState, number>();

export function cleanDetails(value: unknown): string[] {
  const details = cleanStringArray(value, DEFAULT_SYNC_DETAILS);
  return details.length > 0 ? details : [...DEFAULT_SYNC_DETAILS];
}

export function createInitialSyncState(source: Record<string, unknown> = {}): SyncUtilityState {
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

export function clearSyncUtilityTransientState(state: UtilityAppState): void {
  state.sync.error = "";
  state.sync.initForm.error = "";
}

function nextSyncOperationToken(state: SyncUtilityState): number {
  const nextToken = (syncOperationTokens.get(state) ?? 0) + 1;
  syncOperationTokens.set(state, nextToken);
  return nextToken;
}

function isCurrentSyncOperation(state: SyncUtilityState, token: number): boolean {
  return syncOperationTokens.get(state) === token;
}

function logEntries(prefix: string, values: readonly string[]) {
  return values.map((content: string, index: number) => ({ id: `${prefix}-${index}`, content }));
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
  state: UtilityAppState,
  operation: SyncOperation,
  action: () => SyncActionResult | Promise<SyncActionResult>,
  onComplete: RequestRender = () => {}
): void {
  const currentOperation = state.sync.operation;

  if (currentOperation !== null && (currentOperation !== "status" || operation === "status")) {
    return;
  }

  const operationToken = nextSyncOperationToken(state.sync);
  state.sync.operation = operation;
  state.sync.error = "";

  try {
    const result = action();

    if (result && typeof result === "object" && "then" in result && typeof result.then === "function") {
      Promise.resolve(result)
        .then((resolved) => {
          if (!isCurrentSyncOperation(state.sync, operationToken)) {
            return;
          }

          applySyncResult(state.sync, resolved);
        })
        .catch(() => {
          if (!isCurrentSyncOperation(state.sync, operationToken)) {
            return;
          }

          applySyncResult(state.sync, FAILURE_RESULT);
        })
        .finally(() => {
          if (!isCurrentSyncOperation(state.sync, operationToken)) {
            return;
          }

          state.sync.operation = null;
          onComplete();
        });
      return;
    }

    applySyncResult(state.sync, result as SyncActionResult);
  } catch {
    applySyncResult(state.sync, FAILURE_RESULT);
  }

  state.sync.operation = null;
}

export function prepareSyncViewState(state: UtilityAppState, syncActions: SyncActions, onComplete?: RequestRender): void {
  if (state.sync.statusLoaded || state.sync.operation !== null) {
    return;
  }

  runSyncOperation(state, "status", () => syncActions.status(), onComplete);
}

export function resetSyncInitForm(state: UtilityAppState): void {
  state.sync.initForm.remoteUrl = "";
  state.sync.initForm.branch = "main";
  state.sync.initForm.confirmed = false;
  state.sync.initForm.error = "";
  state.sync.error = "";
}

function requiredText(value: string): string {
  return value.trim();
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

export function createSyncActionBar(state: UtilityAppState, syncActions: SyncActions, onComplete?: RequestRender): OptionalTerminalChild {
  return createActionBar({
    actions: [
      createButton("sync-retry", "Retry sync", () => runSyncOperation(state, "retry", () => syncActions.retry(), onComplete)),
      createButton("sync-enable", "Enable sync", () => runSyncOperation(state, "enable", () => syncActions.enable(), onComplete)),
      createButton("sync-disable", "Disable sync", () => runSyncOperation(state, "disable", () => syncActions.disable(), onComplete)),
      createButton("sync-setup", "Set up sync", () => {
        resetSyncInitForm(state);
        state.activeOverlay = "sync-init";
      })
    ]
  });
}

export function createSyncMainView(state: UtilityAppState, _syncActions: SyncActions, _onComplete?: RequestRender): TerminalChild[] {
  const busy = state.sync.operation !== null;

  return [
    <FocusScope>
      <Text>Sync</Text>
      {busy ? <Spinner frame={1} label="Sync in progress" /> : <Text></Text>}
      {state.sync.error ? <Text>{state.sync.error}</Text> : <Text></Text>}
      <LogView
        id="sync-details-scroll"
        height={5}
        entries={logEntries("sync", busy ? [...state.sync.details, "Pending sync"] : state.sync.details)}
        followTail={true}
        emptyText="No sync details yet."
        renderEntry={(entry) => entry.content}
      />
    </FocusScope>
  ];
}

export function createSyncInitOverlay(state: UtilityAppState, syncActions: SyncActions, _layout: SyncOverlayLayout, onComplete?: RequestRender): OptionalTerminalChild {
  if (state.activeOverlay !== "sync-init") {
    return null;
  }

  const form = state.sync.initForm;

  function startSync(): void {
    form.error = "";

    const validationError = validateSyncInitForm(form);

    if (validationError.length > 0) {
      form.error = validationError;
      if (validationError === "Remote URL must not include embedded credentials.") {
        form.remoteUrl = "";
      }
      return;
    }

    runSyncOperation(state, "init", () => syncActions.init({
      remoteUrl: form.remoteUrl.trim(),
      branch: form.branch.trim(),
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
