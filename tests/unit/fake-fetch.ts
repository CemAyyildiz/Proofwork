/** A canned reply, or a ready-made Response for cases a JSON body cannot express. */
export type FakeReply = { status: number; body: unknown; headers?: Record<string, string> } | Response;

/** `fetch` stand-in for the Trustless Work client: no network, one handler per test. */
export function fakeFetch(handler: (url: string, init: RequestInit) => FakeReply): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const reply = handler(String(input), init ?? {});
    if (reply instanceof Response) return reply;
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "content-type": "application/json", ...reply.headers },
    });
  }) as typeof fetch;
}
