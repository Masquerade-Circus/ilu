require('colors');

let clipboardy = require('clipboardy');
let {log} = require('../utils');
let {createGoogleTranslateProvider} = require('./google-translate-provider');

// let exampleResponseSingleWord = {
//     sentences: [{ trans: 'Hola', orig: 'Hello', backend: 1 }],
//     dict: [
//         { pos: 'interjección',
//             terms: [
//                 '¡Hola!',
//                 '¡Caramba!',
//                 '¡Oiga!',
//                 '¡Diga!',
//                 '¡Bueno!',
//                 '¡Vale!',
//                 '¡Aló!'
//             ],
//             entry: [
//                 {
//                     word: '¡Hola!',
//                     reverse_translation: ['Hello!', 'Hi!', 'Hey!', 'Hullo!', 'Hallo!', 'Hoy!'],
//                     score: 0.43686765
//                 },
//                 {
//                     word: '¡Caramba!',
//                     reverse_translation: ['Gee!',
//                         'Well!',
//                         'Good gracious!',
//                         'Well I never!',
//                         'By jingo!',
//                         'By gum!'
//                     ]
//                 },
//                 { word: '¡Oiga!',
//                     reverse_translation: ['Listen!', 'Hello!', 'Hullo!', 'Hallo!', 'I say!', 'See here!'] },
//                 { word: '¡Diga!',
//                     reverse_translation: ['Hello!', 'Hullo!', 'Talk away!'] },
//                 { word: '¡Bueno!',
//                     reverse_translation: ['Well!', 'All right!', 'Hello!', 'Hallo!', 'Hullo!'] },
//                 { word: '¡Vale!',
//                     reverse_translation: ['Okay!', 'O.K.!', 'OK!', 'Okey!', 'Hello!'] },
//                 { word: '¡Aló!',
//                     reverse_translation: ['Hello!', 'Hullo!', 'Halliard!'] }
//             ],
//             base_form: 'Hello!',
//             pos_enum: 9
//         }
//     ],
//     src: 'en',
//     confidence: 1,
//     ld_result: {
//         srclangs: ['en'],
//         srclangs_confidences: [1],
//         extended_srclangs: ['en']
//     }
// };

// let exampleResponsePhrasse = {
//     sentences: [{ trans: 'Hola Mundo', orig: 'Hello world', backend: 1 }],
//     src: 'en',
//     confidence: 0.88673329,
//     ld_result: {
//         srclangs: ['en'],
//         srclangs_confidences: [0.88673329],
//         extended_srclangs: ['en']
//     }
// };


function getOsLang() {
    return (
        process.env.LANG ||
        process.env.LC_NAME ||
        process.env.LANGUAGE ||
        process.env.LC_All ||
        process.env.LC_MESSAGES ||
        'en').slice(0, 2).toLowerCase();
}

function validate(text) {
    let finalText = (text || []).join(' ');
    if (finalText.length > 5000) {
        throw new Error('Maximum number of characters exceeded: 5000');
    }
    return finalText;
}

function createTranslator({
    provider = createGoogleTranslateProvider(),
    clipboard = clipboardy,
    log: logger = log,
    osLang = getOsLang()
} = {}) {
    return {
        validate,
        osLang,
        async action(args, opts) {
            let response = await provider({
                text: args.text,
                source: opts.source,
                target: opts.target
            });

            let translation = (response.sentences || [])[0];
            let interjection = (response.dict || [])[0];

            if (!translation) {
                logger.warning('No translation was found'.yellow, 'yellow');
                return;
            }

            await clipboard.write(translation.trans);

            logger(
                `${response.src.toUpperCase()} > ${opts.target.toUpperCase()}: `.gray
                + translation.trans + ' (Copied to clipboard)'.gray
            );

            if (interjection) {
                let entries = interjection.entry;
                entries.forEach(entry => {
                    logger(entry.word.cyan.italic + ` ${entry.reverse_translation.join(', ')}`.gray);
                });
            }
        }
    };
}

let Translator = createTranslator();

module.exports = Object.assign(Translator, {
    createTranslator
});
