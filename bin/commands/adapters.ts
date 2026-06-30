function createActionAdapter(handler: any, mapArgs: any = () => []) {
  return async (...actionArgs: any[]) => {
    const command = actionArgs[actionArgs.length - 1];
    const positionalArgs = actionArgs.slice(0, -2);
    const opts = command.opts();

    return handler(mapArgs(positionalArgs, opts), opts);
  };
}

function optionalInt(opt: any) {
  return typeof opt === 'boolean' ? opt : parseInt(opt, 10);
}

export { createActionAdapter, optionalInt };
export default { createActionAdapter, optionalInt };
