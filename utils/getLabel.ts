import colors from './colors.ts';
let label = (color: any, content: any) => {
    color = color.replace(/^bg/, '');
    let bgColor = `bg${color}`;
    return (` ${content} ` as any)[bgColor][(colors as any)[color]];
};

export default label;
