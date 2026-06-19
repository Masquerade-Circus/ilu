const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
process.env.TSX_TSCONFIG_PATH = path.join(repoRoot, 'tsconfig.ui.json');
require('tsx/cjs');

const {createBoardKeyBindings} = require('../ui/pages/board/MainView.tsx');

function bindingSignature(binding) {
  return {
    key: binding.key,
    scope: binding.scope,
    focusedTag: binding.when && binding.when.focusedTag,
    commandId: binding.command && binding.command.id
  };
}

test('Board delegates Editor Enter and List press keys to Valyrian defaults', () => {
  const forbiddenBindings = createBoardKeyBindings()
    .map(bindingSignature)
    .filter(binding => {
      const forcesEditorEnter = binding.key === 'ENTER'
        && binding.scope === 'editor'
        && binding.focusedTag === 'terminal-editor';
      const interceptsListPress = (binding.key === 'ENTER' || binding.key === 'SPACE')
        && binding.scope === 'list'
        && binding.focusedTag === 'terminal-list';

      return forcesEditorEnter || interceptsListPress;
    });

  assert.deepEqual(forbiddenBindings, []);
});
