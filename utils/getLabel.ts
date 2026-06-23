let colors = require('./colors');

let label = (color: any, content: any) => {
    color = color.replace(/^bg/, '');
    let bgColor = `bg${color}`;
    return (` ${content} ` as any)[bgColor][colors[color]];
};

module.exports = label;
