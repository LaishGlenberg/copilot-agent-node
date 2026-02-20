import WebSocket, { WebSocketServer } from "ws";

const wss = new WebSocketServer({ port: 8787 });

let extensionSocket = null;

wss.on("connection", (ws) => {
  console.log("Extension connected");
  extensionSocket = ws;

  ws.on("message", (msg) => {
    const data = JSON.parse(msg.toString());
    console.log("From extension:", data);
  });

  ws.on("close", () => {
    extensionSocket = null;
  });
});

// simple request/response helper
function sendCommand(command) {
  return new Promise((resolve) => {
    const id = crypto.randomUUID();

    const payload = { id, ...command };
    extensionSocket.send(JSON.stringify(payload));

    const handler = (msg) => {
      const res = JSON.parse(msg.toString());
      if (res.id === id) {
        extensionSocket.off("message", handler);
        resolve(res);
      }
    };

    extensionSocket.on("message", handler);
  });
}

// example usage
/* setTimeout(async () => {
  if (!extensionSocket) return;

  const tabs = await sendCommand({ action: "list_tabs" });
  console.log("Tabs:", tabs);

}, 4000); */

console.log("MCP server listening on ws://localhost:8787");

setTimeout(async () => {
  const tabs = await sendCommand({ action: "list_tabs" });

  const firstTab = tabs.result[0].id;

  await sendCommand({
    action: "click",
    tabId: firstTab,
    selector: "a"
  });

  const title = await sendCommand({
    action: "eval",
    tabId: firstTab,
    code: "document.title"
  });

  console.log("Title:", title.result);
}, 10000);

