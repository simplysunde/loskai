// Fetch wrapper: JSON in/out, cookie session, and a 401 -> /login redirect so an
// expired session bounces to the security screen instead of silently failing. A change
// refused because Loskai's SSH key is locked (423) asks for your password and is sent again.

import { requestUnlock } from "./unlock";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

// What to show for a failed request: Loskai's own reason, or `fallback` when it never
// answered (a network error's message means nothing to the reader).
export function apiMessage(err: unknown, fallback = "Couldn't reach Loskai"): string {
  return err instanceof ApiError ? err.message : fallback;
}

async function request<T>(path: string, options: RequestInit = {}, again = true): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
  });

  if (res.status === 401) {
    if (typeof window !== "undefined" && window.location.pathname !== "/login") {
      window.location.assign("/login");
    }
    throw new ApiError(401, "Authentication required");
  }

  // Only what you did: a read made in the background (a card opening) shows it is locked
  // instead, and asks when it is clicked.
  if (res.status === 423 && again && (options.method ?? "GET") !== "GET" && (await requestUnlock())) {
    return request<T>(path, options, false);
  }

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch {
      // non-JSON error body — keep statusText
    }
    throw new ApiError(res.status, detail);
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  get: <T>(p: string) => request<T>(p),
  post: <T>(p: string, body?: unknown) =>
    request<T>(p, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(p: string, body?: unknown) =>
    request<T>(p, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(p: string, body?: unknown) =>
    request<T>(p, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  // Raw-body upload (launcher icons). Not multipart: the backend validates by magic
  // bytes, so a form part would only carry a filename and type it ignores.
  upload: <T>(p: string, file: File) =>
    request<T>(p, { method: "POST", body: file, headers: { "Content-Type": "" } }),
  // DELETE may carry a body — AdGuard's rewrite delete takes the whole (domain, answer).
  del: <T>(p: string, body?: unknown) =>
    request<T>(p, { method: "DELETE", body: body ? JSON.stringify(body) : undefined }),
};
