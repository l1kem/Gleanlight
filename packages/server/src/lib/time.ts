/** 把 ISO/SQLite 时间规范化为 SQLite UTC 文本。无效值返回 undefined。 */
export function normalizeScheduledAt(value: unknown): string | null | undefined {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const input = value.trim();
  if (!input) return null;

  // 兼容已经存入数据库的 UTC 文本。
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(input)) return input;
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().slice(0, 19).replace("T", " ");
}
