type CommandOptions = Record<string, unknown>;
type CommandLike = { opts: () => CommandOptions };
type ActionHandler = {
  handle(args: unknown, opts: CommandOptions): unknown | Promise<unknown>;
}['handle'];
type ArgsMapper = (positionalArgs: unknown[], opts: CommandOptions) => unknown;
import { DataConflictError, DataRecoveryError } from '../../sync/iludb-recovery.ts';

function createActionAdapter(handler: ActionHandler, mapArgs: ArgsMapper = () => []) {
  return async (...actionArgs: unknown[]): Promise<void> => {
    const command = actionArgs[actionArgs.length - 1] as CommandLike;
    const positionalArgs = actionArgs.slice(0, -2);
    const opts = command.opts();

    await runActionWithRecovery(() => handler(mapArgs(positionalArgs, opts), opts));
  };
}

async function runActionWithRecovery(action: () => unknown | Promise<unknown>): Promise<void> {
    try {
      await action();
    } catch (error: unknown) {
      if (!(error instanceof DataConflictError)) {
        throw error;
      }

      try {
        const result = await error.reconciliation;
        const message = result.status === 'reconciled'
          ? 'Remote changes were integrated and local data was reloaded. Repeat the action.'
          : 'Local data was reloaded from disk. Repeat the action.';
        process.stderr.write(`${message}\n`);
      } catch (recoveryError: unknown) {
        if (recoveryError instanceof DataRecoveryError) {
          process.stderr.write('Data recovery could not finish safely. The current file was preserved.\n');
          process.exitCode = 1;
          return;
        }
        throw recoveryError;
      }
    }
}

function optionalInt(opt: string | boolean) {
  return typeof opt === 'boolean' ? opt : parseInt(opt, 10);
}

export type { ActionHandler, ArgsMapper, CommandOptions };
export { createActionAdapter, optionalInt, runActionWithRecovery };
export default { createActionAdapter, optionalInt };
