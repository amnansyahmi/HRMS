export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T = Record<string, unknown>>(
  url: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
): Promise<T> {
  if (method !== "GET" && typeof navigator !== "undefined" && !navigator.onLine)
    throw new ApiError("You’re offline. Reconnect before submitting.", 503);
  const response = await fetch(url, {
    method,
    headers:
      body instanceof FormData
        ? undefined
        : body !== undefined
          ? { "Content-Type": "application/json" }
          : undefined,
    body:
      body instanceof FormData
        ? body
        : body !== undefined
          ? JSON.stringify(body)
          : undefined,
    cache: "no-store",
  });
  const result = await response
    .json()
    .catch(() => ({ error: "The server returned an unreadable response" }));
  if (!response.ok)
    throw new ApiError(result.error || "Request failed", response.status);
  return result as T;
}
export const money = (value: unknown) =>
  new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(
    Number(value || 0),
  );
export const shortDate = (value: unknown) =>
  value
    ? new Intl.DateTimeFormat("en-MY", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(new Date(String(value)))
    : "—";
export const initials = (name: string) =>
  name
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();
