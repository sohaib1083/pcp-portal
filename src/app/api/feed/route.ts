import { FEED_ENDPOINTS, FEED_HEADER } from "@/lib/feed";

/** Index of the read-only data feed. Lists the endpoints; returns no data, so it needs no key. */
export async function GET() {
  return Response.json(
    {
      source: "Pharmacy Council of Pakistan, PCP Digital Portal (demo: fictional data)",
      authentication: `Send your key in the ${FEED_HEADER} header. Keys are issued and revoked by PCP.`,
      privacy: "The feed never returns CNICs or personal contact data (phone, email, address).",
      endpoints: FEED_ENDPOINTS.map((e) => ({ path: e.path, what: e.what, fields: e.fields, filters: e.filters })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
