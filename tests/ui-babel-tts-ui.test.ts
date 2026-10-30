import test from 'node:test';
import assert from 'node:assert/strict';
import {captureIluScenario} from './test-helpers/terminal-capture.ts';
import {captureCommand, assertCaptureArtifacts} from './test-helpers/terminal-capture-scenarios.ts';

test('physical capture Translate editor preserves real inputs and actions across growth and shrink without provider calls', async context => {
  const result = await captureIluScenario({testName: context.name, scenario: 'translateEditor', command: captureCommand, viewport: {cols: 80, rows: 24}});
  assert.equal(result.exitCode, 0);
  assertCaptureArtifacts({result, testName: context.name, checkpoints: ['translate-1', 'translate-2', 'translate-3'], diagnostic: message => context.diagnostic(message)});
});

// provider intercepts the external HTTP/SDK boundary in the captured Node
// process. Raw provider responses still pass through real parsing/actions.
// clipboardEquals is demonstrated by pasting into a real visible input.
const success = {sentences: [{trans: 'Hola mundo'}], src: 'en', dict: [{pos: 'interjection', terms: ['Hello'], entry: [{word: 'Hola', reverse_translation: ['Hello']}]}]};
const cases = [
  ['Translate editor uses available height across resize and keeps language fields and actions usable', [
    {key: 'CTRL_6'}, {editorResizeRoundTrip: {domain: 'translation', form: 'translate', documentLines: 64, sizes: [{cols: 80, rows: 24}, {cols: 100, rows: 40}, {cols: 80, rows: 24}], requireMoreLinesOnGrowth: true, requireSameLinesOnShrink: true, requiredControls: ['From', 'To', 'Dictionary', 'Copy result'], editAfterShrink: '!', preserveAcrossTabs: true}},
    {fill: {label: 'From', text: 'en'}}, {fill: {label: 'To', text: 'es'}}, {expect: {texts: ['en', 'es']}}, {externalCalls: {translation: 0}}
  ]],
  ['Translate app opens from top nav and renders approved copy', [{click: 'Translate', area: 'nav'}, {expect: {texts: ['Text to translate', 'From', 'To', 'Copy result', 'Dictionary'], dictionaryState: 'unqueried', withinViewport: true}}]],
  ['Translate utility renders actions in the bottom action area', [{key: 'CTRL_6'}, {expect: {pageBottomActions: ['Translate', 'Copy result'], withinViewport: true}}]],
  ['Translate utility clears stale translation when inputs change or translation fails', [
    {provider: {kind: 'translation', response: success}}, {key: 'CTRL_6'}, {fill: {label: 'Text to translate', text: 'old text'}}, {click: 'Translate', area: 'actions'}, {expect: {text: 'Hola mundo'}},
    {fill: {label: 'Text to translate', text: 'old text updated'}}, {expect: {absent: 'Hola mundo', copyAvailable: false}},
    {provider: {kind: 'translation', response: {error: 'Controlled failure'}}}, {click: 'Translate', area: 'actions'}, {expect: {error: true, copyAvailable: false, absent: 'Hola mundo'}}, {click: 'Copy result'}, {expect: {copyAvailable: false}}, {clipboardEquals: ''}
  ]],
  ['Translate utility validates required fields before calling the action', [{key: 'CTRL_6'}, {click: 'Translate', area: 'actions'}, {expect: {invalid: true}}, {externalCalls: {translation: 0}}]],
  ['Translate utility ignores stale in-flight translation after input changes', [
    {provider: {kind: 'translation', response: {deferred: 'obsolete'}}}, {key: 'CTRL_6'}, {fill: {label: 'Text to translate', text: 'first text'}}, {click: 'Translate', area: 'actions'},
    {fill: {label: 'Text to translate', text: 'first text changed'}}, {releaseProvider: {id: 'obsolete', response: {sentences: [{trans: 'Primera traducción'}]}}},
    {expect: {text: 'first text changed', absent: 'Primera traducción', copyAvailable: false}}, {click: 'Copy result'}, {externalCalls: {translation: 1}}, {clipboardEquals: ''}
  ]],
  ['Translate utility performs translation, displays dictionary, and copies through Valyrian clipboard', [
    {provider: {kind: 'translation', response: success}}, {key: 'CTRL_6'}, {fill: {label: 'Text to translate', text: 'hello world'}}, {click: 'Translate', area: 'actions'},
    {expect: {texts: ['Hola mundo', 'Dictionary', 'Hola', 'Hello']}}, {click: 'Copy result'}, {clipboardEquals: 'Hola mundo'}, {externalCalls: {translation: 1}}
  ]],
  ['TTS utility handles missing credentials without API-key input and uses approved copy', [
    {key: 'CTRL_7'}, {expect: {texts: ['Text to Speech', 'Input file', 'Output file', 'Voice', 'Create audio', 'Start conversion', 'Choose voice'], absent: ['API key', 'password', 'secret']}},
    {click: 'Start conversion'}, {expect: {invalid: true}}, {externalCalls: {speech: 0}}
  ]],
  ['TTS utility renders actions in the bottom action area', [{key: 'CTRL_7'}, {expect: {pageBottomActions: ['Start conversion', 'Choose voice'], withinViewport: true}}]],
  ['TTS voice overlay pins Cancel to the overlay bottom', [{key: 'CTRL_7'}, {click: 'Choose voice'}, {expect: {overlayBottomActions: ['Cancel'], withinViewport: true}}, {key: 'ESCAPE'}]],
  ['TTS voice overlay keeps Cancel visible with the default voice set', [{key: 'CTRL_7'}, {click: 'Choose voice'}, {expect: {texts: ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'], overlayBottomActions: ['Cancel'], withinViewport: true}}, {key: 'ESCAPE'}]],
  ['TTS voice overlay render does not refresh or rewrite voice state', [{remember: ['tts-config']}, {key: 'CTRL_7'}, {click: 'Choose voice'}, {resize: {cols: 100, rows: 40}}, {resize: {cols: 80, rows: 24}}, {expect: {text: 'alloy'}}, {unchanged: ['tts-config']}, {externalCalls: {speech: 0}}, {key: 'ESCAPE'}]],
  ['TTS utility can choose default voice and display audio progress/result through injected adapter', [
    {provider: {kind: 'speech', response: {deferred: 'audio', syntheticAudio: true}}}, {key: 'CTRL_7'}, {click: 'Choose voice'}, {click: 'nova', area: 'overlay'}, {data: {domain: 'tts-config', voice: 'nova'}},
    {fill: {label: 'Input file', valueFrom: 'syntheticTextFile'}}, {fill: {label: 'Output file', valueFrom: 'privateAudioFile'}}, {click: 'Start conversion'}, {expect: {pending: true}},
    {releaseProvider: {id: 'audio', syntheticAudio: true}}, {expect: {audioReady: true}}, {audioFile: {exists: true, nonempty: true}}, {providerRequest: {kind: 'speech', voice: 'nova'}}
  ], {tts: {syntheticCredentials: true, voice: 'alloy', inputText: 'Synthetic audio text'}}],
  ['TTS utility initializes from persisted default voice before creating audio', [
    {provider: {kind: 'speech', response: {syntheticAudio: true}}}, {key: 'CTRL_7'}, {expect: {text: 'nova'}},
    {fill: {label: 'Input file', valueFrom: 'syntheticTextFile'}}, {fill: {label: 'Output file', valueFrom: 'privateAudioFile'}}, {click: 'Start conversion'},
    {expect: {audioReady: true}}, {providerRequest: {kind: 'speech', voice: 'nova'}}, {audioFile: {exists: true, nonempty: true}}
  ], {tts: {syntheticCredentials: true, voice: 'nova', inputText: 'Synthetic audio text'}}],
  ['Translate TUI rejects missing segments without enabling copy', [{provider: {kind: 'translation', response: {sentences: [{trans: 23}]}}}, {key: 'CTRL_6'}, {fill: {label: 'Text to translate', text: 'Example'}}, {click: 'Translate', area: 'actions'}, {expect: {error: true, copyAvailable: false}}, {click: 'Copy result'}, {clipboardEquals: ''}]],
  ['Translate TUI displays and copies every provider segment in order', [{provider: {kind: 'translation', response: {sentences: [{trans: 'Primero. '}, {trans: 'Segundo.'}], src: 'en'}}}, {key: 'CTRL_6'}, {fill: {label: 'Text to translate', text: 'First. Second.'}}, {click: 'Translate', area: 'actions'}, {expect: {text: 'Primero. Segundo.'}}, {click: 'Copy result'}, {clipboardEquals: 'Primero. Segundo.'}]],
  ['terminal integration Translate history excludes drafts, invalid, failed and obsolete requests', [
    {key: 'CTRL_6'}, {provider: {kind: 'translation', response: success}}, {translateText: 'Successful text'},
    {translateText: ''}, {provider: {kind: 'translation', response: {error: 'Controlled failure'}}}, {translateText: 'Failed text'},
    {provider: {kind: 'translation', response: {sentences: []}}}, {translateText: 'Missing result'},
    {provider: {kind: 'translation', response: {deferred: 'obsolete'}}}, {translateText: 'Obsolete text', wait: false},
    {fill: {label: 'Text to translate', text: 'Unsubmitted draft'}}, {releaseProvider: {id: 'obsolete', response: {sentences: [{trans: 'Obsolete result'}]}}},
    {expect: {absent: 'Obsolete result'}}, {key: 'ALT_UP'}, {expect: {inputEquals: {label: 'Text to translate', text: 'Successful text'}}},
    {key: 'ALT_UP'}, {expect: {inputEquals: {label: 'Text to translate', text: 'Successful text'}}},
    {key: 'ALT_DOWN'}, {expect: {inputEquals: {label: 'Text to translate', text: 'Unsubmitted draft'}}}, {externalCalls: {translation: 4}}
  ]],
  ['terminal integration Translate history restores multiline text and the draft across tabs', [
    {provider: {kind: 'translation', response: success}}, {key: 'CTRL_6'}, {translateText: 'First source\nSecond line'}, {translateText: 'Latest source'},
    {key: 'CTRL_1'}, {key: 'CTRL_6'}, {fill: {label: 'Text to translate', text: 'Draft xy'}}, {key: 'LEFT'},
    {key: 'ALT_UP'}, {expect: {inputEquals: {label: 'Text to translate', text: 'Latest source'}}},
    {key: 'ALT_UP'}, {expect: {inputEquals: {label: 'Text to translate', text: 'First source\nSecond line'}}},
    {key: 'ALT_DOWN'}, {key: 'ALT_DOWN'}, {type: '!'}, {expect: {inputEquals: {label: 'Text to translate', text: 'Draft x!y'}}},
    {key: 'ALT_UP', repeat: 2}, {click: 'Translate', area: 'actions'}, {providerRequest: {kind: 'translation', text: 'First source\nSecond line'}}
  ]],
  ['terminal integration Translate history retains only ten distinct recent successful texts', [
    {provider: {kind: 'translation', response: success}}, {key: 'CTRL_6'}, ...Array.from({length: 12}, (_, index) => ({translateText: `Successful-${index + 1}`})),
    {translateText: 'Successful-12'}, {fill: {label: 'Text to translate', text: 'Working draft'}},
    ...Array.from({length: 12}, (_, index) => [{key: 'ALT_UP'}, {expect: {inputEquals: {label: 'Text to translate', text: `Successful-${Math.max(3, 12 - index)}`}}}]).flat(),
    {translateText: 'Successful-3'}, {fill: {label: 'Text to translate', text: 'Another draft'}}, {key: 'ALT_UP'},
    {expect: {inputEquals: {label: 'Text to translate', text: 'Successful-3'}}}, {key: 'ALT_UP'}, {expect: {inputEquals: {label: 'Text to translate', text: 'Successful-12'}}}
  ]],
  ['terminal integration Translate history stays in memory and disappears in a new session', [
    {remember: ['all-app-files']}, {provider: {kind: 'translation', response: success}}, {key: 'CTRL_6'}, {translateText: 'Session-only synthetic source'},
    {fill: {label: 'Text to translate', text: 'Draft'}}, {key: 'ALT_UP'}, {expect: {inputEquals: {label: 'Text to translate', text: 'Session-only synthetic source'}}}, {unchanged: ['all-app-files']},
    {restartAppNormally: true}, {key: 'CTRL_6'}, {fill: {label: 'Text to translate', text: 'New session draft'}}, {key: 'ALT_UP'}, {expect: {inputEquals: {label: 'Text to translate', text: 'New session draft'}}}
  ]],
  ['Translate TUI communicates unavailable copy and pending translation at the controls', [
    {provider: {kind: 'translation', response: {deferred: 'pending'}}}, {key: 'CTRL_6'}, {expect: {copyAvailable: false}},
    {fill: {label: 'Text to translate', text: 'Example'}}, {click: 'Translate', area: 'actions'}, {expect: {pending: true, translateAvailable: false}},
    {click: 'Translate', area: 'actions'}, {externalCalls: {translation: 1}}, {releaseProvider: {id: 'pending', response: {sentences: [{trans: 'Ejemplo'}]}}}, {expect: {text: 'Ejemplo', copyAvailable: true}}
  ]],
  ['Translate first-use guidance distinguishes unqueried and no dictionary results', [
    {provider: {kind: 'translation', response: {sentences: [{trans: 'Ejemplo'}], dict: []}}}, {key: 'CTRL_6'},
    {expect: {dictionaryState: 'unqueried', textPattern: '5[,.]?000', languageExamples: true}}, {translateText: 'Example'},
    {externalCalls: {translation: 1}}, {expect: {dictionaryState: 'no-results'}}
  ]],
  ['Speech TUI marks pending actions unavailable and restores retry after SDK failure', [
    {provider: {kind: 'speech', response: {deferred: 'speech-failure', status: 400}}}, {key: 'CTRL_7'},
    {fill: {label: 'Input file', valueFrom: 'syntheticTextFile'}}, {fill: {label: 'Output file', valueFrom: 'privateAudioFile'}}, {click: 'Start conversion'},
    {expect: {pending: true, speechAvailable: false, voiceChoiceAvailable: false}}, {click: 'Start conversion'}, {click: 'Choose voice'},
    {externalCalls: {speech: 1}}, {audioFile: {exists: false}}, {releaseProvider: {id: 'speech-failure', error: 'Controlled SDK failure'}},
    {expect: {error: true, speechAvailable: true}}, {provider: {kind: 'speech', response: {error: 'Controlled retry failure'}}},
    {click: 'Start conversion'}, {externalCalls: {speech: 2}}, {audioFile: {exists: false}}
  ], {tts: {syntheticCredentials: true, voice: 'alloy', inputText: 'Synthetic audio text'}}]
] as const;

for (const [name, steps, seed] of cases) {
  test(name, async context => {
    const result = await captureIluScenario({testName: context.name, scenario: 'tuiInteraction', command: captureCommand, viewport: {cols: 80, rows: 24}, input: {seed: seed ?? {}, steps: [...steps, {screenshot: 'result'}], externalIsolation: 'deny-unmatched', finish: 'normal-exit'}});
    assert.equal(result.exitCode, 0);
    assertCaptureArtifacts({result, testName: context.name, checkpoints: ['result'], diagnostic: message => context.diagnostic(message)});
  });
}
