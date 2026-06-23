const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

test('README documenta la ruta de llms-full de @valyrianjs/terminal', () => {
  const readme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');

  assert.match(readme, /node_modules\/\@valyrianjs\/terminal\/llms-full\.txt/);
});
