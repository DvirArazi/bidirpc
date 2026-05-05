import {
  createRpcId,
  resultToError,
  serializeError,
  type RpcCallMessage,
  type RpcPollMessage,
  type RpcResultMessage
} from "@bidirpc/core";

export type ClientFunctions = Record<string, (...args: unknown[]) => unknown | Promise<unknown>>;

export type CreateServerCallerOptions = {
  url: string;
  fetchFn?: typeof fetch;
};

export function createServerCaller(options: CreateServerCallerOptions) {
  const fetchFn = options.fetchFn ?? fetch;

  return {
    async call(functionName: string, args: unknown[]): Promise<unknown> {
      const message: RpcCallMessage = {
        type: "call",
        id: createRpcId(),
        functionName,
        args
      };

      const response = await fetchFn(options.url, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(message)
      });

      if (!response.ok) {
        throw new Error(`Server RPC failed with status ${response.status}`);
      }

      const result = (await response.json()) as RpcResultMessage;

      if (!result.ok) {
        throw resultToError(result);
      }

      return result.value;
    }
  };
}

export type ConnectClientOptions = {
  clientId: string;
  pollUrl: string;
  resultUrl: string;
  clientFunctions: ClientFunctions;
  fetchFn?: typeof fetch;
  signal?: AbortSignal;
};

export function connectBidirpcClient(options: ConnectClientOptions): void {
  const fetchFn = options.fetchFn ?? fetch;

  async function sendResult(result: RpcResultMessage): Promise<void> {
    await fetchFn(options.resultUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        clientId: options.clientId,
        result
      })
    });
  }

  async function pollLoop(): Promise<void> {
    while (!options.signal?.aborted) {
      try {
        const url = new URL(options.pollUrl, globalThis.location?.origin);
        url.searchParams.set("clientId", options.clientId);

        const response = await fetchFn(url, {
          method: "GET",
          signal: options.signal
        });

        if (!response.ok) {
          await delay(1000);
          continue;
        }

        const message = (await response.json()) as RpcPollMessage;

        if (message.type === "empty") {
          continue;
        }

        const call = message.call;
        const fn = options.clientFunctions[call.functionName];

        if (!fn) {
          await sendResult({
            type: "result",
            id: call.id,
            ok: false,
            error: {
              message: `Unknown client function: ${call.functionName}`
            }
          });
          continue;
        }

        try {
          const value = await fn(...call.args);

          await sendResult({
            type: "result",
            id: call.id,
            ok: true,
            value
          });
        } catch (error) {
          await sendResult({
            type: "result",
            id: call.id,
            ok: false,
            error: serializeError(error)
          });
        }
      } catch (error) {
        if (options.signal?.aborted) return;
        await delay(1000);
      }
    }
  }

  void pollLoop();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}