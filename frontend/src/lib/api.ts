// Fetch wrapper: JSON in/out, cookie session, and a 401 -> /login redirect so an
// expired session bounces to the security screen instead of silently failing.

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
    ...options,
  });

  if (res.status === 401) {
    if (typeof window !== "undefined" && window.location.pathname !== "/login") {
      window.location.assign("/login");
    }
    throw new ApiError(401, "Authentication required");
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
  // DELETE may carry a body — AdGuard's rewrite delete takes the whole (domain, answer).
  del: <T>(p: string, body?: unknown) =>
    request<T>(p, { method: "DELETE", body: body ? JSON.stringify(body) : undefined }),
  // Raw text — used for the Caddyfile export (text/plain, not JSON).
  text: async (p: string): Promise<string> => {
    const res = await fetch(p, { credentials: "same-origin" });
    if (!res.ok) throw new ApiError(res.status, res.statusText);
    return res.text();
  },
};
