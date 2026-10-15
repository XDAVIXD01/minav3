export function cleanText(content: string, maxLength = 260): string {
  const cleaned = content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/https?:\/\/\S+/gi, " enlace ")
    .replace(/<a?:\w+:\d+>/g, " ")
    .replace(/<[@#][!&]?\d+>/g, " ")
    .replace(/[*_~`|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  const limited = cleaned.length > maxLength ? cleaned.slice(0, maxLength).trimEnd() + "…" : cleaned;
  return /[.!?¡¿…]$/.test(limited) ? limited : limited + ".";
}
