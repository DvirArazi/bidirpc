import { createServerCaller } from "@bidirpc/client";

const caller = createServerCaller({
  url: "/__bidirpc/call-server"
});

export const server = {
  add(a: number, b: number): Promise<number> {
    return caller.call("add", [a, b]) as Promise<number>;
  },

  getServerTime(): Promise<string> {
    return caller.call("getServerTime", []) as Promise<string>;
  }
};