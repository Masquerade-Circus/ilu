import colors from './colors.ts';
type ColorizedString = Record<string, Record<string, string>>;

let label = (color: unknown, content: unknown) => {
    const colorName = String(color).replace(/^bg/, '');
    let bgColor = `bg${colorName}`;
    const foreground = (colors as Record<string, string>)[colorName];
    return ((` ${String(content)} ` as unknown) as ColorizedString)[bgColor][foreground];
};

export default label;
