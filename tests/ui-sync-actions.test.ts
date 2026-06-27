const test = require('node:test');
const assert = require('node:assert/strict');

function createFakeCommands(overrides: any = {}) {
  const calls = [];
  return {
    calls,
    commands: {
      async status() {
        calls.push(['status']);
        if (typeof overrides.status === 'function') {
          return overrides.status();
        }
        return {status: 'healthy', hasPendingRemote: false};
      },
      async retry() {
        calls.push(['retry']);
        if (typeof overrides.retry === 'function') {
          return overrides.retry();
        }
        return {status: 'healthy', hasPendingRemote: false};
      },
      async enable() {
        calls.push(['enable']);
        if (typeof overrides.enable === 'function') {
          return overrides.enable();
        }
        return {status: 'healthy', hasPendingRemote: false};
      },
      async disable() {
        calls.push(['disable']);
        if (typeof overrides.disable === 'function') {
          return overrides.disable();
        }
        return {status: 'disabled', hasPendingRemote: false};
      },
      async init(args, options) {
        calls.push(['init', args, options]);
        if (typeof overrides.init === 'function') {
          return overrides.init(args, options);
        }
        return {enabled: true, remoteUrl: options.remote, branch: options.branch};
      }
    }
  };
}

test('Sync UI adapter maps detailed statuses to approved safe labels', async () => {
  const {createSyncActions} = require('../ui/modules/sync/actions');
  const cases = [
    [{status: 'healthy', hasPendingRemote: false}, 'Synced'],
    [{status: 'healthy', hasPendingRemote: true}, 'Pending sync'],
    [{status: 'pending_remote', hasPendingRemote: true}, 'Pending sync'],
    [{status: 'disabled', hasPendingRemote: false}, 'Sync off'],
    [{status: 'misconfigured', hasPendingRemote: false}, 'Not set up'],
    [{status: 'degraded_network', hasPendingRemote: true, lastErrorKind: 'network'}, 'Sync failed']
  ];

  for (const [status, expectedLabel] of cases) {
    const fake = createFakeCommands({status: () => status});
    const actions = createSyncActions({commands: fake.commands});
    const result = await actions.status();

    assert.equal(result.ok, true, expectedLabel);
    assert.equal(result.label, expectedLabel);
    assert.match(result.details.join('\n'), new RegExp(`Status: ${(expectedLabel as string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  }
});

test('Sync UI adapter redacts unsafe command failures', async () => {
  const {createSyncActions} = require('../ui/modules/sync/actions');
  const fake = createFakeCommands({
    status() {
      throw new Error('failed at /home/person/.ssh/key token=abc123\n    at provider stack');
    }
  });
  const actions = createSyncActions({commands: fake.commands});

  const result = await actions.status();

  assert.deepEqual(result, {
    ok: false,
    error: 'Sync failed. Check your setup and try again.',
    label: 'Sync failed',
    details: ['Status: Sync failed']
  });
  assert.doesNotMatch(JSON.stringify(result), /\/home|\.ssh|token|abc123|stack|provider/i);
});

test('Sync retry, enable, and disable call command functions only after explicit action', async () => {
  const {createSyncActions} = require('../ui/modules/sync/actions');
  const fake = createFakeCommands();
  const actions = createSyncActions({commands: fake.commands});

  assert.deepEqual(fake.calls, []);

  assert.equal((await actions.retry()).ok, true);
  assert.equal((await actions.enable()).ok, true);
  assert.equal((await actions.disable()).ok, true);

  assert.deepEqual(fake.calls.map(call => call[0]), ['retry', 'enable', 'disable']);
});

test('Sync init rejects missing remote URL, branch, and confirmation without command calls', async () => {
  const {createSyncActions} = require('../ui/modules/sync/actions');
  const fake = createFakeCommands();
  const actions = createSyncActions({commands: fake.commands});
  const cases = [
    [{remoteUrl: '', branch: 'main', confirmed: true}, 'Remote URL is required.'],
    [{remoteUrl: './tmp/sync-ui-remote.git', branch: '', confirmed: true}, 'Branch is required.'],
    [{remoteUrl: './tmp/sync-ui-remote.git', branch: 'main', confirmed: false}, 'Confirm setup before starting sync.']
  ];

  for (const [input, expectedError] of cases) {
    const result = await actions.init(input);

    assert.deepEqual(result, {
      ok: false,
      error: expectedError,
      label: 'Not set up',
      details: ['Status: Not set up']
    });
  }

  assert.deepEqual(fake.calls, []);
});

test('Sync init rejects any embedded URL userinfo before command calls', async () => {
  const {createSyncActions} = require('../ui/modules/sync/actions');
  const fake = createFakeCommands();
  const actions = createSyncActions({commands: fake.commands});
  const cases = [
    'https://user:password@example.test/repo.git',
    'https://token@example.test/repo.git',
    'https://ghp_TOKEN@example.test/repo.git'
  ];

  for (const remoteUrl of cases) {
    const result = await actions.init({remoteUrl, branch: 'main', confirmed: true});

    assert.deepEqual(result, {
      ok: false,
      error: 'Remote URL must not include embedded credentials.',
      label: 'Not set up',
      details: ['Status: Not set up']
    }, remoteUrl);
  }

  assert.deepEqual(fake.calls, []);
});

test('Sync init action allows SSH remotes with a normal user', async () => {
  const {createSyncActions} = require('../ui/modules/sync/actions');
  const fake = createFakeCommands();
  const actions = createSyncActions({commands: fake.commands});

  const result = await actions.init({remoteUrl: 'ssh://git@github.com/org/repo.git', branch: 'main', confirmed: true});

  assert.equal(result.ok, true);
  assert.deepEqual(fake.calls, [
    ['init', [], {remote: 'ssh://git@github.com/org/repo.git', branch: 'main'}],
    ['status']
  ]);
});

test('Sync init preserves command safety path and refreshes status after setup', async () => {
  const {createSyncActions} = require('../ui/modules/sync/actions');
  const fake = createFakeCommands({
    status() {
      return {status: 'pending_remote', hasPendingRemote: true};
    }
  });
  const actions = createSyncActions({commands: fake.commands});

  const result = await actions.init({remoteUrl: './tmp/sync-ui-remote.git', branch: 'main', confirmed: true});

  assert.equal(result.ok, true);
  assert.equal(result.label, 'Pending sync');
  assert.deepEqual(fake.calls, [
    ['init', [], {remote: './tmp/sync-ui-remote.git', branch: 'main'}],
    ['status']
  ]);
});


test('Sync UI adapter classifies setup and init safety stops without leaking internals', async () => {
  const {createSyncActions} = require('../ui/modules/sync/actions');
  const setupFake = createFakeCommands({
    status() {
      throw new Error('Sync runtime requires remoteUrl when sync is enabled at /home/person/project');
    }
  });
  const setupActions = createSyncActions({commands: setupFake.commands});

  assert.deepEqual(await setupActions.status(), {
    ok: false,
    error: 'Set up sync before trying again.',
    label: 'Not set up',
    details: ['Status: Not set up']
  });

  const safetyFake = createFakeCommands({
    init() {
      throw new Error('Initialization stopped to avoid overwriting data at /home/person/project');
    }
  });
  const safetyActions = createSyncActions({commands: safetyFake.commands});
  const result = await safetyActions.init({remoteUrl: './tmp/sync-ui-remote.git', branch: 'main', confirmed: true});

  assert.deepEqual(result, {
    ok: false,
    error: 'Setup stopped to protect your files.',
    label: 'Not set up',
    details: ['Status: Not set up']
  });
  assert.doesNotMatch(JSON.stringify(result), /\/home|project|overwriting|stack|token|secret/i);
});
