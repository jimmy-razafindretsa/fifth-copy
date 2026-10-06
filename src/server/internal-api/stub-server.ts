import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// In-process HTTP stub standing in for the race server in tests (#103). Not imported by app code.
export type StubRequest = {
  method?: string;
  url?: string;
  headers: IncomingHttpHeaders;
  body: string;
};
export type StubReply = { status: number; body?: unknown } | "hang";

export type RaceServerStub = {
  url: string;
  requests: StubRequest[];
  reply: (next: (request: StubRequest) => StubReply) => void;
  close: () => Promise<void>;
};

export async function startRaceServerStub(): Promise<RaceServerStub> {
  const requests: StubRequest[] = [];
  let respond: (request: StubRequest) => StubReply = () => ({ status: 200, body: {} });
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
    req.on("end", () => {
      const request = { method: req.method, url: req.url, headers: req.headers, body };
      requests.push(request);
      const reply = respond(request);
      if (reply === "hang") return;
      res.writeHead(reply.status, { "content-type": "application/json" });
      res.end(JSON.stringify(reply.body ?? {}));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    reply: (next) => void (respond = next),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

// A URL nothing listens on: bind port 0, then release it.
export async function unreachableUrl(): Promise<string> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return `http://127.0.0.1:${port}`;
}
