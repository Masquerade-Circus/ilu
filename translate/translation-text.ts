export function translationText(response: unknown): string | null {
  if (typeof response !== "object" || response === null || !("sentences" in response) || !Array.isArray(response.sentences)) {
    return null;
  }

  const segments: string[] = [];
  for (const sentence of response.sentences) {
    if (typeof sentence !== "object" || sentence === null || typeof sentence.trans !== "string") {
      return null;
    }
    segments.push(sentence.trans);
  }
  const text = segments.join("");
  return text.trim().length > 0 ? text : null;
}
