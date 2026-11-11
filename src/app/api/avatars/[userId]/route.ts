import { avatarQuery, getViewer, readAvatarFile } from "@/features/identity";
import { shareLobby } from "@/features/lobby/server";

// Avatars are served only here (ADR 0014): authorization first, then bytes we encoded ourselves.
// Who may see one: its owner, and lobby mates by `shareLobby` (ADR 0022, #880). The answer depends
// on the cookie, so every response says `Vary: Cookie` and is `private`: no shared cache may keep it.
const VARY = { Vary: "Cookie" };
const NO_STORE = { "Cache-Control": "private, no-store", ...VARY };

export async function GET(request: Request, ctx: { params: Promise<{ userId: string }> }) {
  const url = new URL(request.url);
  const query = avatarQuery.safeParse({
    size: url.searchParams.get("size") ?? undefined,
    v: url.searchParams.get("v") ?? undefined,
  });
  if (!query.success) return new Response(null, { status: 400, headers: NO_STORE });

  const { userId } = await ctx.params;
  const bytes = await readAvatarFile(
    await getViewer(),
    userId,
    query.data.v,
    query.data.size,
    (viewerId, ownerId) => shareLobby(viewerId, ownerId),
  );
  if (!bytes) return new Response(null, { status: 404, headers: NO_STORE });

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "image/webp",
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
      ...VARY,
    },
  });
}
