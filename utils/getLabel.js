let colors = require('./colors');

let label = (color, content) => {
    color = color.replace(/^bg/, '');
    let bgColor = `bg${color}`;
    return ` ${content} `[bgColor][colors[color]];
};

module.exports = label;
