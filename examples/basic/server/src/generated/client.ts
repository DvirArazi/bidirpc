import type { createBidirpcServer } from "@bidirpc/server";

type BidirpcServer = ReturnType<typeof createBidirpcServer>;

export function client(rpc: BidirpcServer, clientId: string) {
  return {
    confirm(message: string): Promise<boolean> {
      return rpc.client(clientId).call("confirm", [message]) as Promise<boolean>;
    },

    alert(message: string): Promise<void> {
      return rpc.client(clientId).call("alert", [message]) as Promise<void>;
    }
  };
}