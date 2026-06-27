import { positiveInteger } from "./number-guards";

export function wrappedTerminalText(value: string, width: number): string {
  const safeWidth = positiveInteger(width) ? width : 1;
  const words = value.trim().split(/\s+/).filter((word: string) => word.length > 0);
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    if (word.length > safeWidth) {
      if (currentLine.length > 0) {
        lines.push(currentLine);
        currentLine = "";
      }

      for (let index = 0; index < word.length; index += safeWidth) {
        lines.push(word.slice(index, index + safeWidth));
      }

      continue;
    }

    const candidate = currentLine.length > 0 ? currentLine + " " + word : word;

    if (candidate.length <= safeWidth) {
      currentLine = candidate;
      continue;
    }

    if (currentLine.length > 0) {
      lines.push(currentLine);
    }

    currentLine = word;
  }

  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines.join("\n") : "";
}

export function cardDetailsHeadingWidth(totalWidth: number): number {
  const paneHorizontalChrome = 4;

  return Math.max(1, totalWidth - paneHorizontalChrome);
}
