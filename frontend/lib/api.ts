const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export type Tokens = { access_token: string; refresh_token: string };
export type Citation = {
  source: string;
  chunk_index: number;
  doc_id: string;
  score: number;
};

const TOKEN_KEY = "rag.access";

export function saveToken(t: string) {
  if (typeof window !== "undefined") localStorage.setItem(TOKEN_KEY, t);
}
export function getToken(): string | null {
  return typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
}
export function clearToken() {
  if (typeof window !== "undefined") localStorage.removeItem(TOKEN_KEY);
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed (${res.status})`);
  }
  return res.json();
}

export async function signup(email: string, password: string) {
  const res = await fetch(`${API}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return json<Tokens>(res);
}

export async function login(email: string, password: string) {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return json<Tokens>(res);
}

export async function uploadDoc(file: File) {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`${API}/ingest`, {
    method: "POST",
    headers: { Authorization: `Bearer ${getToken()}` },
    body: fd,
  });
  return json<{ doc_id: string; filename: string; chunk_count: number }>(res);
}

export async function ask(question: string) {
  const res = await fetch(`${API}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify({ question }),
  });
  return json<{ answer: string; citations: Citation[] }>(res);
}
