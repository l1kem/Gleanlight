import { reactive } from "vue";

/** 轻提示 store：失败/异步结果才提示；可见结果保持沉默 */
export interface ToastItem {
  id: number;
  text: string;
  kind: "info" | "error" | "success";
}

export const toastState = reactive<{ items: ToastItem[] }>({ items: [] });
let seq = 0;

function show(text: string, kind: ToastItem["kind"]): void {
  const item = { id: ++seq, text, kind };
  toastState.items.push(item);
  setTimeout(() => {
    const i = toastState.items.indexOf(item);
    if (i > -1) toastState.items.splice(i, 1);
  }, kind === "error" ? 6000 : 3200);
}

export function toast(text: string, kind: ToastItem["kind"] = "info"): void {
  show(text, kind);
}

export function toastError(err: unknown): void {
  show(err instanceof Error ? err.message : String(err), "error");
}
