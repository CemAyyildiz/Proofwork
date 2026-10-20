/** POST to the campaign's payouts route; a non-2xx answer throws the server's message. */
export async function payoutsCall<T = unknown>(campaignId: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/payouts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(json.message ?? `request failed (${res.status})`);
  return json;
}
