import { serveFeed } from "@/lib/feed";

/** Read-only data feed (guide section 14). Needs an X-PCP-Feed-Key header; every call is audited. */
export async function GET(req: Request, ctx: { params: Promise<{ resource: string }> }) {
  const { resource } = await ctx.params;
  return serveFeed(req, resource);
}
