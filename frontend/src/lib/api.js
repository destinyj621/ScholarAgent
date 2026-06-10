const BASE = import.meta.env.VITE_API_URL || "";

export async function api(path, { body, method, headers, ...rest } = {}) {
  const isForm = body instanceof FormData;
  const resp = await fetch(`${BASE}${path}`, {
    method: method ?? (body ? "POST" : "GET"),
    headers: isForm ? headers : { "Content-Type": "application/json", ...headers },
    body: isForm ? body : body != null ? JSON.stringify(body) : undefined,
    ...rest,
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error(err.detail || "Request failed");
  }
  return resp.json();
}
