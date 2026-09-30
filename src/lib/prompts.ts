// Prompt history (↑ / ↓ in the Overview input), newest first, kept in this browser profile.
const KEY = "promptHistory";
const MAX = 60;

export function promptHistory(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Newest first, without duplicates. */
export function withPrompt(list: string[], text: string, max = MAX): string[] {
  const t = text.trim();
  if (!t) return list;
  return [t, ...list.filter((x) => x !== t)].slice(0, max);
}

export function rememberPrompt(text: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(withPrompt(promptHistory(), text)));
  } catch {
    /* storage unavailable */
  }
}
