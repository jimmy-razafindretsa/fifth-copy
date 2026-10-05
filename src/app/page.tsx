import Link from "next/link";
import { Card } from "@/components/ui";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-12 md:px-8 md:py-20">
      <h1 className="text-3xl font-semibold tracking-tight text-fg">App</h1>
      <p className="text-lg text-fg-muted">
        Foundations are in place. Features arrive one card at a time through the agent loop.
      </p>
      <Card className="flex flex-col gap-2">
        <h2 className="text-lg font-medium text-fg">Start here</h2>
        <ul className="list-disc space-y-1 pl-5 text-fg-muted">
          <li>
            Rules: <code className="font-mono text-sm">AGENTS.md</code>
          </li>
          <li>
            Protocol: <code className="font-mono text-sm">agents/PROTOCOL.md</code>
          </li>
          <li>
            <Link className="text-link underline underline-offset-4" href="/design">
              Design system primitives
            </Link>
          </li>
        </ul>
      </Card>
    </main>
  );
}
