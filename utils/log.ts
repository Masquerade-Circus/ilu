type SymbolName = keyof typeof fallbackSymbols;
type ColorizedIcon = string & Record<string, string | undefined>;
type LogMethod = (message: unknown, color?: string, spaces?: number) => void;
type LogFunction = ((message: unknown, spaces?: number, type?: SymbolName | null, color?: string) => void) &
    Record<SymbolName, LogMethod>;

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

function symbol(type: SymbolName, color: string) {
    let icon = fallbackSymbols[type] || '';
    let colorizedIcon = icon as ColorizedIcon;
    return color && colorizedIcon[color] ? colorizedIcon[color] : icon;
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
] as const;

const log = (function log(message: unknown, spaces = 2, type: SymbolName | null = null, color = 'white') {
    let str = '';
    for (;spaces--;) {
        str += ' ';
    }
    if (type !== null) {
        str += symbol(type, color) + ' ';
    }

    str += message;
    console.log(str);
}) as LogFunction;

logMethods.forEach((method) => {
    log[method] = (message: unknown, color?: string, spaces?: number) => log(message, spaces, method, color);
});

export default log;
