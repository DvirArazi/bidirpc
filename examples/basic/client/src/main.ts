import { connectBidirpcClient } from "@bidirpc/client";
import { server } from "./generated/server.js";
import { clientFunctions } from "./remote/client.remote.js";

const clientId = crypto.randomUUID();

const clientIdElement = document.querySelector<HTMLElement>("#client-id")!;
const outputElement = document.querySelector<HTMLPreElement>("#output")!;
const callServerButton = document.querySelector<HTMLButtonElement>("#call-server-button")!;
const askClientButton = document.querySelector<HTMLButtonElement>("#ask-client-button")!;

clientIdElement.textContent = clientId;

function log(message: string): void {
  outputElement.textContent += `${message}\n`;
}

connectBidirpcClient({
  clientId,
  pollUrl: "/__bidirpc/poll",
  resultUrl: "/__bidirpc/client-result",
  clientFunctions
});

callServerButton.addEventListener("click", async () => {
  try {
    const result = await server.add(2, 3);
    log(`server.add(2, 3) returned: ${result}`);

    const time = await server.getServerTime();
    log(`server.getServerTime() returned: ${time}`);
  } catch (error) {
    log(`Error calling server: ${String(error)}`);
  }
});

askClientButton.addEventListener("click", async () => {
  try {
    const response = await fetch("/demo/ask-client", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ clientId })
    });

    const body = (await response.json()) as {
      ok: boolean;
      answer?: boolean;
      error?: string;
    };

    if (!body.ok) {
      log(`Server failed to call client: ${body.error}`);
      return;
    }

    log(`server → client confirm returned: ${body.answer}`);
  } catch (error) {
    log(`Error asking server to call client: ${String(error)}`);
  }
});

log("Client connected. Long-poll loop is running.");