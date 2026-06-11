import { Editor, FocusScope, Input, Text, View } from "@valyrianjs/terminal";
import type {
  TerminalEditorChangeEventPayload,
  TerminalInputChangeEventPayload,
  TerminalStyleValue
} from "@valyrianjs/terminal";
import { createButton } from "./Button";
import { AppOverlay } from "./Overlay";

export type EditOverlayProps = {
  heading: string;
  error?: string;
  titleLabel: string;
  titleInputId: string;
  titleValue: string;
  titlePlaceholder?: string;
  editorLabel: string;
  editorId: string;
  editorValue: string;
  editorPlaceholder?: string;
  editorHeight: number;
  width?: number;
  height?: number;
  inputStyle?: TerminalStyleValue;
  inputFocusStyle?: TerminalStyleValue;
  editorStyle?: TerminalStyleValue;
  editorFocusStyle?: TerminalStyleValue;
  primaryActionId: string;
  primaryActionLabel?: string;
  cancelActionId: string;
  cancelLabel?: string;
  onTitleInput: (value: string) => void;
  onEditorInput: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
};

export function EditOverlay(props: EditOverlayProps): JSX.Element {
  const {
    heading,
    error = "",
    titleLabel,
    titleInputId,
    titleValue,
    titlePlaceholder,
    editorLabel,
    editorId,
    editorValue,
    editorPlaceholder,
    editorHeight,
    width,
    height,
    inputStyle,
    inputFocusStyle,
    editorStyle,
    editorFocusStyle,
    primaryActionId,
    primaryActionLabel = "Save",
    cancelActionId,
    cancelLabel = "Cancel",
    onTitleInput,
    onEditorInput,
    onSave,
    onCancel
  } = props;

  const inputStyles = inputFocusStyle ? { focus: inputFocusStyle } : undefined;
  const editorStyles = editorFocusStyle ? { focus: editorFocusStyle } : undefined;

  return (
    <AppOverlay trapFocus={true} width={width} height={height} content={[
      <FocusScope>
        <Text>{heading}</Text>
        {error ? <Text state="error">{error}</Text> : <Text></Text>}
        <Text>{titleLabel}</Text>
        <Input
          id={titleInputId}
          value={titleValue}
          placeholder={titlePlaceholder}
          style={inputStyle}
          styles={inputStyles}
          oninput={(event: TerminalInputChangeEventPayload) => onTitleInput(event.value)}
          onsubmit={onSave}
        />
        <Text>{editorLabel}</Text>
        <Editor
          id={editorId}
          value={editorValue}
          placeholder={editorPlaceholder}
          height={editorHeight}
          style={editorStyle}
          styles={editorStyles}
          oninput={(event: TerminalEditorChangeEventPayload) => onEditorInput(event.value)}
          oncancel={onCancel}
        />
      </FocusScope>
    ]}
    bottomNav={
      <View direction="row" gap={1}>
        {createButton(primaryActionId, primaryActionLabel, onSave)}
        {createButton(cancelActionId, cancelLabel, onCancel)}
      </View>
    }
    />
  );
}
