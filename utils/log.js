let symbol = require('node-symbols');
let logMethods = [
    'tick',
    'cross',
    'star',
    'square',
    'squareSmall',
    'squareSmallFilled',
    'play',
    'circle',
    'circleFilled',
    'circleDotted',
    'circleDouble',
    'circleCircle',
    'circleCross',
    'circlePipe',
    'circleQuestionMark',
    'bullet',
    'dot',
    'line',
    'ellipsis',
    'pointer',
    'pointerSmall',
    'info',
    'warning',
    'hamburger',
    'smiley',
    'mustache',
    'heart',
    'arrowUp',
    'arrowDown',
    'arrowLeft',
    'arrowRight',
    'radioOn',
    'radioOff',
    'checkboxOn',
    'checkboxOff',
    'checkboxCircleOn',
    'checkboxCircleOff'
];

function log(message, spaces = 2, type = null, color = 'white') {
    let str = '';
    for (;spaces--;) {
        str += ' ';
    }
    if (type !== null) {
        str += symbol(type, color) + ' ';
    }

    str += message;
    console.log(str);
};

logMethods.forEach(method => {
    log[method] = (message, color, spaces) => log(message, spaces, method, color);
});

module.exports = log;
