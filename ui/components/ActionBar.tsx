import { Text, View } from "@valyrianjs/terminal";
import type { OptionalTerminalChild, TerminalChild } from "../types";

type ActionBarOptions = {
  actions: JSX.Element[];
  isActive?: boolean;
};

export function createActionBar(options: ActionBarOptions): OptionalTerminalChild {
  const { actions, isActive = true } = options;

  if (isActive !== true || actions.length === 0) {
    return null;
  }

  return (
    <>
      <Text></Text>
      <View direction="row" gap={1}>
        {actions}
      </View>
    </>
  ) as TerminalChild;
}
