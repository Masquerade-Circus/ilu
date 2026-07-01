import * as __cjsImport1 from './adapters.ts';
const { createActionAdapter } = __cjsImport1;
import type { Command } from 'commander';
import type { ActionHandler } from './adapters.ts';

const boardManagementAliases = new Map([
  ['-ab', '--add-board'],
  ['-eb', '--edit-board'],
  ['-rb', '--remove-board']
]);

function normalizeBoardManagementArgv(argv: readonly string[] | undefined) {
  if (!Array.isArray(argv)) {
    return argv;
  }

  return argv.map((value) => boardManagementAliases.get(value) || value);
}

function wrapBoardParseAliases(program: Command) {
  const originalParse = program.parse.bind(program);
  program.parse = function patchedParse(argv, parseOptions) {
    return originalParse(normalizeBoardManagementArgv(argv), parseOptions);
  };

  if (typeof program.parseAsync === 'function') {
    const originalParseAsync = program.parseAsync.bind(program);
    program.parseAsync = function patchedParseAsync(argv, parseOptions) {
      return originalParseAsync(normalizeBoardManagementArgv(argv), parseOptions);
    };
  }
}

function registerBoardManagementOption(command: Command, shortFlag: string, longFlag: string, description: string) {
  command.option(longFlag, description);

  if (Array.isArray(command.options) && command.options.length > 0) {
    command.options[command.options.length - 1].flags = `${shortFlag}, ${longFlag}`;
  }

  return command;
}

function registerBoardCommands(program: Command, deps: { Scrumban: { Board: { actions: ActionHandler } } }) {
  const boardCommand = program
    .command('board')
    .alias('bd')
    .description('Manage the current board and board collection')
    .option('-s, --show', 'Show the current board as an adaptive ASCII view')
    .option('-a, --add', 'Add a new card to the default column')
    .option('-d, --details', 'Show details of the selected card interactively')
    .option('-e, --edit', 'Edit the selected card interactively')
    .option('-m, --move', 'Move selected cards interactively')
    .option('-p, --priority', 'Reorder cards within a selected column interactively')
    .option('-r, --remove', 'Remove selected cards interactively')
    .option('-c, --columns', 'Manage columns for the current board')
    .option('-l, --list-boards', 'Show all boards')
    .option('-u, --use-board', 'Use the selected board interactively');

  registerBoardManagementOption(boardCommand, '-ab', '--add-board', 'Add new board');
  registerBoardManagementOption(boardCommand, '-eb', '--edit-board', 'Edit the selected board interactively');
  registerBoardManagementOption(boardCommand, '-rb', '--remove-board', 'Remove selected boards interactively');

  boardCommand.action(createActionAdapter(deps.Scrumban.Board.actions));
}

export { registerBoardCommands, wrapBoardParseAliases };
export default { registerBoardCommands, wrapBoardParseAliases };
