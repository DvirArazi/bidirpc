export type RpcCallMessage = {
  type: "call";
  id: string;
  functionName: string;
  args: unknown[];
};

export type RpcResultMessage =
  | {
      type: "result";
      id: string;
      ok: true;
      value: unknown;
    }
  | {
      type: "result";
      id: string;
      ok: false;
      error: {
        name?: string;
        message: string;
        stack?: string;
      };
    };

export type RpcPollMessage =
  | {
      type: "client-call";
      call: RpcCallMessage;
    }
  | {
      type: "empty";
    };

export function createRpcId(): string {
  return crypto.randomUUID();
}

export function serializeError(error: unknown): {
  name?: string;
  message: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }

  return {
    message: String(error)
  };
}

export function resultToError(result: Extract<RpcResultMessage, { ok: false }>): Error {
  const error = new Error(result.error.message);
  error.name = result.error.name ?? "RemoteError";
  return error;
}