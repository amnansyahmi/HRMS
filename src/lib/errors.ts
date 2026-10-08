import { ZodError } from "zod";
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "AppError";
  }
}
export function fail(message: string, status = 400): never {
  throw new AppError(message, status);
}
export function responseError(error: unknown) {
  if (error instanceof ZodError)
    return Response.json(
      {
        error: error.issues
          .map((i) => `${i.path.join(".") || "Form"}: ${i.message}`)
          .join("; "),
      },
      { status: 400 },
    );
  if (error instanceof AppError)
    return Response.json({ error: error.message }, { status: error.status });
  if ((error as { code?: string })?.code === "23505")
    return Response.json(
      { error: "This record already exists. Refresh and try again." },
      { status: 409 },
    );
  console.error(
    "HRMS request failed",
    error instanceof Error ? error.message : "Unknown error",
  );
  return Response.json(
    { error: "The request could not be completed. Please try again." },
    { status: 500 },
  );
}
export async function handle(fn: () => Promise<Response>) {
  try {
    return await fn();
  } catch (error) {
    return responseError(error);
  }
}
