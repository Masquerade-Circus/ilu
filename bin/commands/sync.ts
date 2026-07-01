import * as __cjsImport2 from './adapters.ts';
const { createActionAdapter } = __cjsImport2;

import type { Command } from 'commander';
import type { ActionHandler } from './adapters.ts';

type SyncDeps = {
  Sync: {
    init: ActionHandler;
    status: ActionHandler;
    retry: ActionHandler;
    enable: ActionHandler;
    disable: ActionHandler;
  };
};

function registerSyncCommands(program: Command, deps: SyncDeps) {
  const syncCommand = program
    .command('sync')
    .description('Manage personal data sync');

  syncCommand
    .command('init')
    .description('Initialize sync against a remote repository')
    .requiredOption('--remote <url>', 'Remote repository URL')
    .option('--branch <name>', 'Remote branch', 'main')
    .action(createActionAdapter(deps.Sync.init));

  syncCommand
    .command('status')
    .description('Show sync status')
    .action(createActionAdapter(deps.Sync.status));

  syncCommand
    .command('retry')
    .description('Retry pending sync work')
    .action(createActionAdapter(deps.Sync.retry));

  syncCommand
    .command('enable')
    .description('Enable sync')
    .action(createActionAdapter(deps.Sync.enable));

  syncCommand
    .command('disable')
    .description('Disable sync')
    .action(createActionAdapter(deps.Sync.disable));
}

export { registerSyncCommands };
export default { registerSyncCommands };
