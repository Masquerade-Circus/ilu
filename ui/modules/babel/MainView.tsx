import { Editor, FocusScope, Input, ScrollView, Spinner, Text, View } from "@valyrianjs/terminal";
import type { TerminalEditorChangeEventPayload, TerminalInputChangeEventPayload } from "@valyrianjs/terminal";
import { createActionBar } from "../../components/ActionBar";
import { createButton } from "../../components/Button";
import type { BabelActionResult, BabelActions, BabelUtilityState, OptionalTerminalChild, TerminalChild, UtilityRuntimeState } from "../../types";
import { cleanStringArray, cleanText } from "../../components/utility/text";

type RequestRender = () => void;
type CopyText = (text: string) => BabelActionResult | Promise<BabelActionResult>;

const BABEL_FAILURE: BabelActionResult = Object.freeze({ ok: false, error: "Could not translate the text." });

export function createInitialBabelState(source: Record<string, unknown> = {}): BabelUtilityState {
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

export function clearBabelUtilityTransientState(state: UtilityRuntimeState): void {
  state.babel.error = "";
  state.babel.message = "";
}

function clearBabelResult(state: BabelUtilityState): void {
  state.translation = "";
  state.dictionaryEntries = [];
}

function requiredText(value: string): string {
  return value.trim();
}

export function invalidateBabelInput(state: BabelUtilityState): void {
  state.inputVersion += 1;
  state.error = "";
  state.message = "";
  clearBabelResult(state);
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
    .then((result) => {
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
    .then((result) => {
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

export function createTranslateActionBar(state: UtilityRuntimeState, babelActions: BabelActions, copyText: CopyText, onComplete?: RequestRender): OptionalTerminalChild {
  return createActionBar({
    actions: [
      createButton("translate-start", "Translate", () => runTranslate(state, babelActions, onComplete)),
      createButton("translate-copy", "Copy result", () => copyTranslation(state, copyText, onComplete))
    ]
  });
}

export function createBabelMainView(state: UtilityRuntimeState, _babelActions: BabelActions, _onComplete?: RequestRender): TerminalChild[] {
  const busy = state.babel.operation !== null;

  return [
    <FocusScope>
      <Text>Translate</Text>
      {busy ? <Spinner frame={1} label="Translation in progress" /> : <Text></Text>}
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
          ? state.babel.dictionaryEntries.map((entry: any) => <Text>{entry}</Text>)
          : <Text>No dictionary entries found.</Text>}
      </ScrollView>
    </FocusScope>
  ];
}
