const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export type Tokens = { access_token: string; refresh_token: string };
export type Citation = {
  source: string;
  chunk_index: number;
  doc_id: string;
  score: number;
  page_number: number | null;
  chunk_text: string;
  url?: string | null;
};

export type AmbientPayload = {
  lat?: number;
  lon?: number;
  city?: string;
  country?: string;
  timestamp?: string;
};

export type ChatMode = "doc" | "personal" | "web";

const TOKEN_KEY = "rag.access";
const REFRESH_KEY = "rag.refresh";

export function saveToken(t: string) {
  if (typeof window !== "undefined") localStorage.setItem(TOKEN_KEY, t);
}
export function getToken(): string | null {
  return typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
}
export function clearToken() {
  if (typeof window !== "undefined") {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
  }
}
export function saveRefreshToken(t: string) {
  if (typeof window !== "undefined") localStorage.setItem(REFRESH_KEY, t);
}
export function getRefreshToken(): string | null {
  return typeof window !== "undefined" ? localStorage.getItem(REFRESH_KEY) : null;
}

export function getUserId(): string | null {
  const token = getToken();
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.sub || null;
  } catch {
    return null;
  }
}

async function tryRefresh(): Promise<boolean> {
  const rt = getRefreshToken();
  if (!rt) return false;
  try {
    const res = await fetch(`${API}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: rt }),
    });
    if (!res.ok) return false;
    const data: Tokens = await res.json();
    saveToken(data.access_token);
    saveRefreshToken(data.refresh_token);
    return true;
  } catch {
    return false;
  }
}

async function json<T>(res: Response, retry?: () => Promise<Response>): Promise<T> {
  if (res.status === 401 && retry) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      const retried = await retry();
      if (retried.ok) return retried.json();
    }
    clearToken();
    window.location.href = "/";
    throw new Error("Session expired — please log in again");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = Array.isArray(body.detail)
      ? body.detail.map((e: any) => `${e.loc?.slice(-1)[0] ?? "field"}: ${e.msg}`).join("; ")
      : body.detail;
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return res.json();
}

export async function signup(email: string, password: string) {
  const res = await fetch(`${API}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await json<Tokens>(res);
  saveToken(data.access_token);
  saveRefreshToken(data.refresh_token);
  return data;
}

export async function login(email: string, password: string) {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await json<Tokens>(res);
  saveToken(data.access_token);
  saveRefreshToken(data.refresh_token);
  return data;
}

export async function uploadDoc(file: File) {
  const doFetch = () => {
    const fd = new FormData();
    fd.append("file", file);
    return fetch(`${API}/ingest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${getToken()}` },
      body: fd,
    });
  };
  const res = await doFetch();
  return json<{ doc_id: string; filename: string; chunk_count: number }>(res, doFetch);
}

export async function ingestUrl(url: string) {
  const doFetch = () =>
    fetch(`${API}/ingest/url`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ url }),
    });
  const res = await doFetch();
  return json<{ doc_id: string; filename: string; chunk_count: number }>(res, doFetch);
}

export async function deleteDoc(docId: string) {
  const doFetch = () =>
    fetch(`${API}/ingest/${encodeURIComponent(docId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${getToken()}` },
    });
  const res = await doFetch();
  if (res.status === 204) return;
  return json<void>(res, doFetch);
}

export async function ask(question: string, mode: ChatMode = "doc", docIds: string[] | null = null) {
  const doFetch = () =>
    fetch(`${API}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getToken()}`,
      },
      body: JSON.stringify({ question, mode, doc_ids: docIds }),
    });
  const res = await doFetch();
  return json<{ answer: string; citations: Citation[] }>(res, doFetch);
}

export type HistoryMessage = { role: "user" | "assistant"; content: string };

export async function extractText(file: File): Promise<{ text: string; filename: string; truncated: boolean }> {
  const doFetch = () => {
    const fd = new FormData();
    fd.append("file", file);
    return fetch(`${API}/ingest/extract-text`, {
      method: "POST",
      headers: { Authorization: `Bearer ${getToken()}` },
      body: fd,
    });
  };
  const res = await doFetch();
  return json<{ text: string; filename: string; truncated: boolean }>(res, doFetch);
}

export async function askStream(
  question: string,
  mode: ChatMode,
  docIds: string[] | null,
  onCitations: (citations: Citation[]) => void,
  onToken: (token: string) => void,
  onError: (msg: string) => void,
  onDone: () => void,
  history: HistoryMessage[] = [],
  attachmentText?: string | null,
  attachmentName?: string | null,
  imageData?: string | null,
  imageMime?: string,
  ambientPayload?: AmbientPayload | null,
): Promise<void> {
  const makeReq = () =>
    fetch(`${API}/chat/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getToken()}`,
      },
      body: JSON.stringify({
        question, mode, doc_ids: docIds, history,
        attachment_text: attachmentText ?? null,
        attachment_name: attachmentName ?? null,
        image_data: imageData ?? null,
        image_mime: imageMime ?? "image/jpeg",
        ambient_payload: ambientPayload ?? null,
      }),
    });

  let res = await makeReq();

  if (res.status === 401) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      res = await makeReq();
    } else {
      clearToken();
      window.location.href = "/";
      return;
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = Array.isArray(body.detail)
      ? body.detail.map((e: any) => `${e.loc?.slice(-1)[0] ?? "field"}: ${e.msg}`).join("; ")
      : body.detail;
    throw new Error(detail || `Request failed (${res.status})`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (!raw) continue;
      try {
        const data = JSON.parse(raw);
        if (data.type === "citations") onCitations(data.citations);
        else if (data.type === "token") onToken(data.content);
        else if (data.type === "error") onError(data.message);
        else if (data.type === "done") onDone();
      } catch { /* skip malformed event */ }
    }
  }
}

export async function generateTitle(question: string, answer: string): Promise<string> {
  const doFetch = () =>
    fetch(`${API}/chat/title`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ question, answer }),
    });
  const res = await doFetch();
  const data = await json<{ title: string }>(res, doFetch);
  return data.title;
}

export async function getMemories() {
  const doFetch = () =>
    fetch(`${API}/memory`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
  const res = await doFetch();
  return json<{ items: { id: string; memory: string }[] }>(res, doFetch);
}

export async function clearMemories() {
  const doFetch = () =>
    fetch(`${API}/memory`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${getToken()}` },
    });
  const res = await doFetch();
  if (res.status === 204) return;
  return json<void>(res, doFetch);
}
