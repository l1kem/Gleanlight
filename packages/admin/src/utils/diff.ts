/** 行级 LCS diff：用于版本历史对比。超长文本截断保护，避免 O(n·m) 爆内存 */
export interface DiffLine {
  type: "same" | "add" | "del";
  text: string;
}

const MAX_LINES = 2000;

export function diffLines(before: string, after: string): DiffLine[] {
  const A = before.split("\n").slice(0, MAX_LINES);
  const B = after.split("\n").slice(0, MAX_LINES);
  const n = A.length;
  const m = B.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      out.push({ type: "same", text: A[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: "del", text: A[i] });
      i += 1;
    } else {
      out.push({ type: "add", text: B[j] });
      j += 1;
    }
  }
  while (i < n) out.push({ type: "del", text: A[i++] });
  while (j < m) out.push({ type: "add", text: B[j++] });
  return out;
}
