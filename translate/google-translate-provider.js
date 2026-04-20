let {log} = require('../utils');

let baseUrl = 'https://translate.google.com/translate_a/single?client=at&dt=t&dt=ld&dt=qca&dt=rm&dt=bd&dj=1&hl=es-ES&ie=UTF-8&oe=UTF-8&inputm=2&otf=2&iid=1dd3b944-fa62-4b55-b330-74909a99969e';

function createGoogleTranslateProvider({
    fetchImpl = globalThis.fetch,
    log: logger = log,
    exit = code => process.exit(code)
} = {}) {
    return async function googleTranslateProvider({text, source, target}) {
        let url = `${baseUrl}&sl=${source}&tl=${target}&q=${encodeURIComponent(text)}`;
        let response = await fetchImpl(url, {
            method: 'get',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'AndroidTranslate/5.3.0.RC02.130475354-53000263 5.1 phone TRANSLATE_OPM5_TEST_1'
            }
        });

        if (response.status < 200 || response.status > 300) {
            logger.cross(response.statusText.red, 'red');
            exit(1);
            return;
        }

        return response.json();
    };
}

module.exports = {
    createGoogleTranslateProvider
};
