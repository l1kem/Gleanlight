import { reactive } from "vue";
import { api } from "../api";

export interface Me {
  id: number;
  username: string;
}

export const auth = reactive<{ user: Me | null; checked: boolean }>({
  user: null,
  checked: false,
});

export async function checkAuth(): Promise<void> {
  try {
    auth.user = await api.get<Me>("/auth/me");
  } catch {
    auth.user = null;
  } finally {
    auth.checked = true;
  }
}

export async function login(username: string, password: string): Promise<void> {
  auth.user = await api.post<Me>("/auth/login", { username, password });
}

export async function logout(): Promise<void> {
  await api.post("/auth/logout");
  auth.user = null;
}
