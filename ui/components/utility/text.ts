export function cleanText(value: unknown, fallback: string = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function cleanStringArray(value: unknown, fallback: readonly string[] = []): string[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const values = value.filter((item: unknown): item is string => typeof item === "string" && item.trim().length > 0).map((item: string) => item.trim());
  return values.length > 0 ? values : [...fallback];
}
