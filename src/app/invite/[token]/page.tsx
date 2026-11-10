import { LandingHeader } from "@/features/landing";
import { InvitePage } from "@/features/lobby";

/** A single-use invite link (#809): the invitation, or the refusal; the press consumes it. */
export default async function Invite({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  return (
    <>
      <LandingHeader />
      <main className="flex flex-1 flex-col">
        <InvitePage token={token} />
      </main>
    </>
  );
}
