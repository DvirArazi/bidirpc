import { Buffer } from "node:buffer";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, type Plugin } from "vite";
import { createBidirpcServer } from "@bidirpc/server";
import { client } from "./server/src/generated/client";
import { serverFunctions } from "./server/src/remote/server.remote";

export default defineConfig({
  root: "client",
  plugins: [bidirpcBasicServer()]
});

function bidirpcBasicServer(): Plugin {
  const rpc = createBidirpcServer({
    serverFunctions,
    pollTimeoutMs: 25_000,
    clientCallTimeoutMs: 30_000
  });

  return {
    name: "bidirpc-basic-server",

    configureServer(server) {
      server.middlewares.use(async (nodeRequest, nodeResponse, next) => {
        try {
          if (!nodeRequest.url) {
            next();
            return;
          }

          const request = await toWebRequest(nodeRequest);
          const url = new URL(request.url);

          if (request.method === "POST" && url.pathname === "/__bidirpc/call-server") {
            await sendWebResponse(nodeResponse, await rpc.handleServerCall(request));
            return;
          }

          if (request.method === "GET" && url.pathname === "/__bidirpc/poll") {
            await sendWebResponse(nodeResponse, await rpc.handleClientPoll(request));
            return;
          }

          if (request.method === "POST" && url.pathname === "/__bidirpc/client-result") {
            await sendWebResponse(nodeResponse, await rpc.handleClientResult(request));
            return;
          }

          if (request.method === "POST" && url.pathname === "/demo/ask-client") {
            const body = (await request.json()) as { clientId?: string };

            if (!body.clientId) {
              sendJson(nodeResponse, { ok: false, error: "Missing clientId" }, 400);
              return;
            }

            try {
              const answer = await client(rpc, body.clientId).confirm(
                "This confirm() was called from the server. Continue?"
              );

              sendJson(nodeResponse, {
                ok: true,
                answer
              });
              return;
            } catch (error) {
              sendJson(
                nodeResponse,
                {
                  ok: false,
                  error: String(error)
                },
                500
              );
              return;
            }
          }

          next();
        } catch (error) {
          sendJson(
            nodeResponse,
            {
              ok: false,
              error: String(error)
            },
            500
          );
        }
      });
    }
  };
}

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

function sendJson(nodeResponse: ServerResponse, value: unknown, status = 200): void {
  nodeResponse.statusCode = status;
  nodeResponse.setHeader("content-type", "application/json");
  nodeResponse.end(JSON.stringify(value));
}