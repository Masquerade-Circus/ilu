const test = require('node:test');
const assert = require('node:assert/strict');
const {v} = require('valyrian.js');
const {mountTerminal} = require('@valyrianjs/terminal');


test('Valyrian Overlay modal shield blocks click-through to covered background hitboxes', () => {
  let backgroundPresses = 0;
  const session = mountTerminal(
    v("terminal-screen", {title: 'Overlay hit test'},
      v("terminal-button", {id: 'background', onpress: () => { backgroundPresses += 1; }}, 'Background action'),
      v("terminal-overlay", {margin: {x: 0, y: 1}, trapFocus: true, backdrop: true, style: {background: '#000000'}},
        v("terminal-text", null, 'Overlay covers this row visually')
      )
    ),
    {cols: 40, rows: 6, runtime: 'headless'}
  );

  session.clickAt(2, 2);

  assert.equal(backgroundPresses, 0);
  session.destroy();
});

test('Valyrian Overlay trapFocus keeps sequential focus inside overlay and blocks direct focusAt on covered background', () => {
  let backgroundPresses = 0;
  let modalPresses = 0;
  const session = mountTerminal(
    v("terminal-screen", {title: 'Overlay focus test'},
      v("terminal-button", {id: 'background', onpress: () => { backgroundPresses += 1; }}, 'Background action'),
      v("terminal-overlay", {margin: {x: 0, y: 1}, trapFocus: true, backdrop: true, style: {background: '#000000'}},
        v("terminal-focus-scope", null,
          v("terminal-text", null, 'Overlay covers background row'),
          v("terminal-button", {id: 'modal', onpress: () => { modalPresses += 1; }}, 'Modal action')
        )
      )
    ),
    {cols: 40, rows: 6, runtime: 'headless'}
  );

  session.focus('modal');
  session.focusNext();
  session.dispatchKey('ENTER');
  assert.equal(modalPresses, 1);
  assert.equal(backgroundPresses, 0);

  assert.equal(session.focusAt(2, 2), false);
  session.dispatchKey('ENTER');
  assert.equal(backgroundPresses, 0);
  assert.equal(modalPresses, 2);

  session.destroy();
});


test('Valyrian Overlay modal shield blocks empty-area click-through while preserving modal controls', () => {
  let backgroundPresses = 0;
  let modalPresses = 0;
  const session = mountTerminal(
    v("terminal-screen", {title: 'Overlay shield test'},
      v("terminal-button", {id: 'background', onpress: () => { backgroundPresses += 1; }}, 'Background action'),
      v("terminal-overlay", {margin: {x: 0, y: 1}, trapFocus: true, backdrop: true, style: {background: '#000000'}},
        v("terminal-focus-scope", null,
          v("terminal-text", null, 'Overlay covers background row'),
          v("terminal-button", {id: 'modal', onpress: () => { modalPresses += 1; }}, 'Modal action')
        )
      )
    ),
    {cols: 40, rows: 6, runtime: 'headless'}
  );

  session.clickAt(2, 2);
  assert.equal(backgroundPresses, 0);
  assert.equal(modalPresses, 0);

  session.clickAt(2, 3);
  assert.equal(backgroundPresses, 0);
  assert.equal(modalPresses, 1);

  session.destroy();
});
