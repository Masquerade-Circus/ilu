import * as __cjsImport4 from 'commander';
const { Option } = __cjsImport4;
import * as __cjsImport5 from './adapters.ts';
const { createActionAdapter, optionalInt } = __cjsImport5;
import type { Command } from 'commander';
import type { ActionHandler } from './adapters.ts';

type UtilityDeps = {
  Translate: { osLang: string; validate: (text: unknown) => unknown; action: ActionHandler };
  Clocks: { actions: ActionHandler };
  Tts: { action: ActionHandler; voiceAction: ActionHandler };
};

function registerUiCommand(program: Command, deps: { Ui: { action: ActionHandler } }) {
  program
    .command('ui')
    .description('Open the ilu terminal workspace preview')
    .action(createActionAdapter(deps.Ui.action));
}

function registerUtilityCommands(program: Command, deps: UtilityDeps) {
  program
    .command('babel')
    .alias('b')
    .description('Translate text')
    .addOption(new Option('-s, --source [source]', 'Source language').default('auto'))
    .addOption(new Option('-t, --target [target]', 'Target language').default(deps.Translate.osLang))
    .argument('<text...>', 'Text to translate')
    .action(createActionAdapter(
      deps.Translate.action,
      ([text]: unknown[]) => ({text: deps.Translate.validate(text)})
    ));

  program
    .command('clock')
    .alias('c')
    .description('Manage saved clocks')
    .option('-a, --add', 'Add a new clock')
    .option('-s, --show', 'Show all saved clocks')
    .option('-p, --priority', 'Reorder saved clocks interactively')
    .option('-r, --remove [position]', 'Remove the clock at [position], if no position, remove all clocks', optionalInt)
    .action(createActionAdapter(deps.Clocks.actions));

  const ttsCommand = program
    .command('tts')
    .description('Convert a text or markdown file to audio')
    .argument('<inputFile>', 'Input .txt or .md file')
    .argument('<outputFile>', 'Output audio file path');

  ttsCommand
    .command('voice')
    .description('Select or persist the default TTS voice')
    .action(createActionAdapter(deps.Tts.voiceAction, () => ({})));

  ttsCommand.action(createActionAdapter(
    deps.Tts.action,
    ([inputFile, outputFile]: unknown[]) => ({inputFile, outputFile})
  ));
}

export { registerUiCommand, registerUtilityCommands };
export default { registerUiCommand, registerUtilityCommands };
