import { getActor, assertOrigin } from "@/lib/auth";
import { askAI, aiHistory } from "@/lib/ai";
import { handle, AppError } from "@/lib/errors";
import { jsonBody } from "@/lib/request";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  return handle(async () => {
    assertOrigin(request);
    const actor = await getActor(),
      body = await jsonBody(request);
    if (!request.headers.get("accept")?.includes("application/x-ndjson"))
      return Response.json(await askAI(actor, body, request.signal), {
        headers: { "Cache-Control": "private, no-store" },
      });
    const abort = new AbortController();
    const cancelled = () => abort.abort();
    request.signal.addEventListener("abort", cancelled, { once: true });
    if (request.signal.aborted) abort.abort();
    let closed = false;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();
        const send = (event: unknown) => {
          if (!closed && !abort.signal.aborted)
            controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        };
        try {
          const result = await askAI(actor, body, abort.signal, {
            progress: (message) => send({ type: "progress", message }),
            text: (text) => send({ type: "text", text }),
          });
          send({ type: "complete", result });
        } catch (error) {
          send({
            type: "error",
            message:
              error instanceof AppError
                ? error.message
                : "The answer could not be completed. Please retry.",
          });
        } finally {
          request.signal.removeEventListener("abort", cancelled);
          if (!closed) {
            closed = true;
            controller.close();
          }
        }
      },
      cancel() {
        closed = true;
        abort.abort();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "private, no-store",
        "X-Accel-Buffering": "no",
      },
    });
  });
}
export async function GET(request: Request) {
  return handle(async () =>
    Response.json(
      await aiHistory(
        await getActor(),
        new URL(request.url).searchParams.get("thread") || undefined,
      ),
      { headers: { "Cache-Control": "private, no-store" } },
    ),
  );
}
