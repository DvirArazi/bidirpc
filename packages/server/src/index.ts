import {
  createRpcId,
  serializeError,
  type RpcCallMessage,
  type RpcPollMessage,
  type RpcResultMessage
} from "@bidirpc/core";

export type ServerFunctions = Record<string, (...args: any[]) => unknown | Promise<unknown>>;

export type CreateBidirpcServerOptions = {
  serverFunctions: ServerFunctions;
  pollTimeoutMs?: number;
  clientCallTimeoutMs?: number;
};

type PendingPoll = {
  resolve: (message: RpcPollMessage) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type PendingClientCall = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
};

export function createBidirpcServer(options: CreateBidirpcServerOptions) {
  const pollTimeoutMs = options.pollTimeoutMs ?? 25_000;
  const clientCallTimeoutMs = options.clientCallTimeoutMs ?? 30_000;

  const pendingPolls = new Map<string, PendingPoll>();
  const clientQueues = new Map<string, RpcCallMessage[]>();
  const pendingClientCalls = new Map<string, PendingClientCall>();

  function enqueueClientCall(clientId: string, call: RpcCallMessage): void {
    const pendingPoll = pendingPolls.get(clientId);

    if (pendingPoll) {
      clearTimeout(pendingPoll.timeout);
      pendingPolls.delete(clientId);
      pendingPoll.resolve({
        type: "client-call",
        call
      });
      return;
    }

    const queue = clientQueues.get(clientId) ?? [];
    queue.push(call);
    clientQueues.set(clientId, queue);
  }

  async function callClient(
    clientId: string,
    functionName: string,
    args: unknown[]
  ): Promise<unknown> {
    const call: RpcCallMessage = {
      type: "call",
      id: createRpcId(),
      functionName,
      args
    };

    const promise = new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingClientCalls.delete(call.id);
        reject(new Error(`Client call timed out: ${functionName}`));
      }, clientCallTimeoutMs);

      pendingClientCalls.set(call.id, {
        resolve,
        reject,
        timeout
      });
    });

    enqueueClientCall(clientId, call);

    return promise;
  }

  return {
    async handleServerCall(request: Request): Promise<Response> {
      const call = (await request.json()) as RpcCallMessage;
      const fn = options.serverFunctions[call.functionName];

      let result: RpcResultMessage;

      if (!fn) {
        result = {
          type: "result",
          id: call.id,
          ok: false,
          error: {
            message: `Unknown server function: ${call.functionName}`
          }
        };
      } else {
        try {
          const value = await fn(...call.args);

          result = {
            type: "result",
            id: call.id,
            ok: true,
            value
          };
        } catch (error) {
          result = {
            type: "result",
            id: call.id,
            ok: false,
            error: serializeError(error)
          };
        }
      }

      return json(result);
    },

    async handleClientPoll(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const clientId = url.searchParams.get("clientId");

      if (!clientId) {
        return json({ error: "Missing clientId" }, 400);
      }

      const queue = clientQueues.get(clientId);

      if (queue && queue.length > 0) {
        const call = queue.shift()!;

        return json({
          type: "client-call",
          call
        } satisfies RpcPollMessage);
      }

      const message = await new Promise<RpcPollMessage>((resolve) => {
        const timeout = setTimeout(() => {
          pendingPolls.delete(clientId);
          resolve({
            type: "empty"
          });
        }, pollTimeoutMs);

        pendingPolls.set(clientId, {
          resolve,
          timeout
        });
      });

      return json(message);
    },

    async handleClientResult(request: Request): Promise<Response> {
      const body = (await request.json()) as {
        clientId: string;
        result: RpcResultMessage;
      };

      const pending = pendingClientCalls.get(body.result.id);

      if (!pending) {
        return json({ ok: false, error: "Unknown or expired call id" }, 404);
      }

      clearTimeout(pending.timeout);
      pendingClientCalls.delete(body.result.id);

      if (body.result.ok) {
        pending.resolve(body.result.value);
      } else {
        pending.reject(new Error(body.result.error.message));
      }

      return json({ ok: true });
    },

    client(clientId: string) {
      return {
        call(functionName: string, args: unknown[]): Promise<unknown> {
          return callClient(clientId, functionName, args);
        }
      };
    }
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}