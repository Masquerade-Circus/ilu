let fallbackSymbols = {
    tick: '✔',
    cross: '✖',
    star: '★',
    square: '▇',
    squareSmall: '◻',
    squareSmallFilled: '◼',
    play: '▶',
    circle: '◯',
    circleFilled: '◉',
    circleDotted: '◌',
    circleDouble: '◎',
    circleCircle: 'ⓞ',
    circleCross: 'ⓧ',
    circlePipe: 'Ⓘ',
    circleQuestionMark: '?',
    bullet: '●',
    dot: '․',
    line: '─',
    ellipsis: '…',
    pointer: '❯',
    pointerSmall: '›',
    info: 'ℹ',
    warning: '⚠',
    hamburger: '☰',
    smiley: '㋡',
    mustache: '෴',
    heart: '♥',
    arrowUp: '↑',
    arrowDown: '↓',
    arrowLeft: '←',
    arrowRight: '→',
    radioOn: '◉',
    radioOff: '◯',
    checkboxOn: '☒',
    checkboxOff: '☐',
    checkboxCircleOn: 'ⓧ',
    checkboxCircleOff: 'Ⓘ'
};

function symbol(type: any, color: any) {
    let icon = (fallbackSymbols as any)[type] || '';
    return color && icon[color] ? icon[color] : icon;
}

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

function log(message: any, spaces: any = 2, type: any = null, color: any = 'white') {
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

logMethods.forEach((method: any) => {
    (log as any)[method] = (message: any, color: any, spaces: any) => log(message, spaces, method, color);
});

module.exports = log;
