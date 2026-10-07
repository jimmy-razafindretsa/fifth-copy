import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { PROTOCOL_VERSION, type StartRaceResponse } from "@fifth-copy/protocol";

// Test-only in-process HTTP stub standing in for the web app's internal API (#199), the mirror of
// the web's `src/server/internal-api/stub-server.ts` (services never import src/). Not imported by
// app code. It answers `POST /api/internal/races` with `STUB_TEXT`, acknowledges every results
// chunk and records every request.

export type WebStubRequest = {
  method?: string;
  url?: string;
  headers: IncomingHttpHeaders;
  body: string;
};

/** The text every start answered by the stub gets. */
export const STUB_TEXT = {
  content: "It was the best of times, it was the worst of times.",
  language: "en",
  wordCount: 12,
  sourceRef: "seed:en:v1",
} satisfies StartRaceResponse["text"];

export type WebStub = {
  url: string;
  requests: WebStubRequest[];
  close(): Promise<void>;
};

export async function startWebStub(now: () => number = Date.now): Promise<WebStub> {
  const requests: WebStubRequest[] = [];
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      const parsed = JSON.parse(body) as {
        raceId: string;
        settings: unknown;
        results?: { desk: number }[];
      };
      // `POST /api/internal/races/:id/results` (#189): every desk of the chunk is acknowledged.
      const answer = parsed.results
        ? {
            v: PROTOCOL_VERSION,
            raceId: parsed.raceId,
            persisted: parsed.results.map((r) => r.desk),
          }
        : {
            v: PROTOCOL_VERSION,
            raceId: parsed.raceId,
            text: STUB_TEXT,
            settings: parsed.settings,
            startedAt: now(),
          };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(answer));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
