// Pure helpers, safe to import from client components.
export function formatPKR(n: number) {
  return "Rs " + n.toLocaleString("en-PK");
}

export function daysUntil(dateStr: string | null | undefined) {
  if (!dateStr) return null;
  const ms = new Date(dateStr + "T00:00:00").getTime() - Date.now();
  return Math.ceil(ms / 86400000);
}
