type CommandOptions = Record<string, unknown>;
type CommandLike = { opts: () => CommandOptions };
type ActionHandler = {
  handle(args: unknown, opts: CommandOptions): unknown | Promise<unknown>;
}['handle'];
type ArgsMapper = (positionalArgs: unknown[], opts: CommandOptions) => unknown;

function createActionAdapter(handler: ActionHandler, mapArgs: ArgsMapper = () => []) {
  return async (...actionArgs: unknown[]): Promise<void> => {
    const command = actionArgs[actionArgs.length - 1] as CommandLike;
    const positionalArgs = actionArgs.slice(0, -2);
    const opts = command.opts();

    await handler(mapArgs(positionalArgs, opts), opts);
  };
}

function optionalInt(opt: string | boolean) {
  return typeof opt === 'boolean' ? opt : parseInt(opt, 10);
}

export type { ActionHandler, ArgsMapper, CommandOptions };
export { createActionAdapter, optionalInt };
export default { createActionAdapter, optionalInt };
