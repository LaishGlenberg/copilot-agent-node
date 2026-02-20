import WebSocket from "ws";

const ws = new WebSocket("ws://localhost:8888");

// Example: Get tabs
let command = { action: "list_tabs" };

// Or uncomment for a click:
command = { action: "click", tabId: 1633580634, selector: "button" };

ws.on("open", () => {
  ws.send(JSON.stringify(command));
});

ws.on("message", (data) => {
  const response = JSON.parse(data.toString());
  console.log("Response from extension:", JSON.stringify(response, null, 2));
  process.exit(0);
});

ws.on("error", (err) => {
  console.error("Server not running?", err.message);
  process.exit(1);
});
