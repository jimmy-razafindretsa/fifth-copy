import { avatarQuery, getViewer, readAvatarFile } from "@/features/identity";

// Avatars are served only here (ADR 0014): authorization first, then bytes we encoded ourselves.
const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(request: Request, ctx: { params: Promise<{ userId: string }> }) {
  const url = new URL(request.url);
  const query = avatarQuery.safeParse({
    size: url.searchParams.get("size") ?? undefined,
    v: url.searchParams.get("v") ?? undefined,
  });
  if (!query.success) return new Response(null, { status: 400, headers: NO_STORE });

  const { userId } = await ctx.params;
  const bytes = await readAvatarFile(await getViewer(), userId, query.data.v, query.data.size);
  if (!bytes) return new Response(null, { status: 404, headers: NO_STORE });

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "image/webp",
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}
