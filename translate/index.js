let fetch = require('node-fetch');
let clipboardy = require('clipboardy');
let {log} = require('../utils');

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


let Translator = {
    validate(text) {
        let finalText = (text || []).join(' ');
        if (finalText.length > 5000) {
            throw new Error('Maximum number of characters exceeded: 5000');
        }
        return finalText;
    },
    osLang: (
        process.env.LANG ||
        process.env.LC_NAME ||
        process.env.LANGUAGE ||
        process.env.LC_All ||
        process.env.LC_MESSAGES ||
        'en').slice(0, 2).toLowerCase(),
    async action(args, opts) {
        let url = 'https://translate.google.com/translate_a/single?client=at&dt=t&dt=ld&dt=qca&dt=rm&dt=bd&dj=1&hl=es-ES&ie=UTF-8&oe=UTF-8&inputm=2&otf=2&iid=1dd3b944-fa62-4b55-b330-74909a99969e';
        url += `&sl=${opts.source}&tl=${opts.target}&q=${encodeURIComponent(args.text)}`;
        let response = await fetch(url, {
            method: 'get',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'AndroidTranslate/5.3.0.RC02.130475354-53000263 5.1 phone TRANSLATE_OPM5_TEST_1'
            }
        }).then(res => {
            if (res.status < 200 || res.status > 300) {
                log.cross(res.statusText.red, 'red');
                process.exit(1);
            }

            return res.json();
        });

        let translation = (response.sentences || [])[0];
        let interjection = (response.dict || [])[0];

        if (!translation) {
            log.warning('No translation was found'.yellow, 'yellow');
            return;
        }

        await clipboardy.write(translation.trans);

        log(
            `${response.src.toUpperCase()} > ${opts.target.toUpperCase()}: `.gray
            + translation.trans + ' (Copied to clipboard)'.gray
        );

        if (interjection) {
            let entries = interjection.entry;
            entries.forEach(entry => {
                log(entry.word.cyan.italic + ` ${entry.reverse_translation.join(', ')}`.gray);
            });
        }
    }
};

module.exports = Translator;
