import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { createBidirpcServer } from "@bidirpc/server";
import { client } from "./generated/client.js";
import { serverFunctions } from "./remote/server.remote.js";

const rpc = createBidirpcServer({
  serverFunctions,
  pollTimeoutMs: 25_000,
  clientCallTimeoutMs: 30_000
});

const clientPublicDir = new URL("../../client/public/", import.meta.url);
const clientDistDir = new URL("../../client/dist/", import.meta.url);

const server = createServer(async (nodeRequest, nodeResponse) => {
  try {
    const request = await toWebRequest(nodeRequest);
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return sendFile(nodeResponse, new URL("index.html", clientPublicDir), "text/html");
    }

    if (request.method === "GET" && url.pathname.startsWith("/client/")) {
      const relativePath = decodeURIComponent(url.pathname.slice("/client/".length));

      if (!relativePath || relativePath.includes("..")) {
        return sendJson(nodeResponse, { error: "Invalid path" }, 400);
      }

      return sendFile(
        nodeResponse,
        new URL(relativePath, clientDistDir),
        contentTypeFor(relativePath)
      );
    }

    if (request.method === "POST" && url.pathname === "/__bidirpc/call-server") {
      return sendWebResponse(nodeResponse, await rpc.handleServerCall(request));
    }

    if (request.method === "GET" && url.pathname === "/__bidirpc/poll") {
      return sendWebResponse(nodeResponse, await rpc.handleClientPoll(request));
    }

    if (request.method === "POST" && url.pathname === "/__bidirpc/client-result") {
      return sendWebResponse(nodeResponse, await rpc.handleClientResult(request));
    }

    if (request.method === "POST" && url.pathname === "/demo/ask-client") {
      const body = (await request.json()) as { clientId?: string };

      if (!body.clientId) {
        return sendJson(nodeResponse, { ok: false, error: "Missing clientId" }, 400);
      }

      try {
        const answer = await client(rpc, body.clientId).confirm(
          "This confirm() was called from the server. Continue?"
        );

        return sendJson(nodeResponse, {
          ok: true,
          answer
        });
      } catch (error) {
        return sendJson(
          nodeResponse,
          {
            ok: false,
            error: String(error)
          },
          500
        );
      }
    }

    return sendJson(nodeResponse, { error: "Not found" }, 404);
  } catch (error) {
    return sendJson(
      nodeResponse,
      {
        error: String(error)
      },
      500
    );
  }
});

server.listen(3000, "127.0.0.1", () => {
  console.log("bidirpc basic example running at http://127.0.0.1:3000");
});

async function toWebRequest(nodeRequest: IncomingMessage): Promise<Request> {
  const url = `http://${nodeRequest.headers.host}${nodeRequest.url}`;

  const body =
    nodeRequest.method === "GET" || nodeRequest.method === "HEAD"
      ? undefined
      : await readRequestBody(nodeRequest);

  return new Request(url, {
    method: nodeRequest.method,
    headers: nodeRequest.headers as HeadersInit,
    body: body === undefined ? undefined : new Uint8Array(body)
  });
}

function readRequestBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    request.on("end", () => {
      resolve(Buffer.concat(chunks));
    });

    request.on("error", reject);
  });
}

async function sendWebResponse(
  nodeResponse: ServerResponse,
  response: Response
): Promise<void> {
  nodeResponse.statusCode = response.status;

  response.headers.forEach((value, key) => {
    nodeResponse.setHeader(key, value);
  });

  const body = await response.arrayBuffer();
  nodeResponse.end(Buffer.from(body));
}

async function sendFile(
  nodeResponse: ServerResponse,
  fileUrl: URL,
  contentType: string
): Promise<void> {
  try {
    const contents = await readFile(fileUrl);
    nodeResponse.statusCode = 200;
    nodeResponse.setHeader("content-type", contentType);
    nodeResponse.end(contents);
  } catch {
    sendJson(nodeResponse, { error: "File not found" }, 404);
  }
}

function sendJson(nodeResponse: ServerResponse, value: unknown, status = 200): void {
  nodeResponse.statusCode = status;
  nodeResponse.setHeader("content-type", "application/json");
  nodeResponse.end(JSON.stringify(value));
}

function contentTypeFor(path: string): string {
  if (path.endsWith(".js")) return "text/javascript";
  if (path.endsWith(".css")) return "text/css";
  if (path.endsWith(".html")) return "text/html";
  if (path.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}