interface Env {
  [key: string]: unknown;
}

type PagesFunction<
  T extends Record<string, unknown> = Env,
> = (context: {
  request: Request;
  env: T;
  params: Record<string, string>;
  waitUntil: (promise: Promise<unknown>) => void;
  next: () => Promise<Response>;
  data: Record<string, unknown>;
}) => Promise<Response>;
