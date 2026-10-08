import { fail } from "./errors";
export async function readBody(request: Request, max = 128000) {
  if (Number(request.headers.get("content-length") || 0) > max)
    fail("Request is too large", 413);
  const reader = request.body?.getReader();
  if (!reader) fail("Request body is required");
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      fail("Request is too large", 413);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
export async function jsonBody(request: Request) {
  try {
    return JSON.parse((await readBody(request)).toString());
  } catch (e) {
    if (e instanceof SyntaxError) fail("Invalid JSON request");
    throw e;
  }
}
