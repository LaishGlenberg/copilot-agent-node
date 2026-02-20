import WebSocket from "ws";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const ws = new WebSocket("ws://localhost:8888");
const rl = readline.createInterface({ input, output });

// Helper to send a command and wait for the response
function request(command) {
  return new Promise((resolve, reject) => {
    const handler = (data) => {
      ws.off("message", handler);
      resolve(JSON.parse(data.toString()));
    };
    ws.on("message", handler);
    ws.send(JSON.stringify(command));
    
    // Safety timeout
    setTimeout(() => {
      ws.off("message", handler);
      reject(new Error("Request timed out"));
    }, 10000);
  });
}

async function startInteractive() {
  console.log("Connected to Control Server. Commands: 'list', 'click <id> <selector>', 'eval <id> <code>', 'get_els <id>', 'exit'");

  while (true) {
    const answer = await rl.question("\n> ");
    const [cmd, ...args] = answer.trim().split(" ");

    try {
      if (cmd === "list") {
        const res = await request({ action: "list_tabs" });
        if (res.error) console.error("Error:", res.error);
        else console.log(JSON.stringify(res.result, null, 2)); //console.table(res.result);

      } else if (cmd === "click") {
        const [tabId, selector] = args;
        if (!tabId || !selector) {
          console.log("Usage: click <tabId> <selector>");
          continue;
        }
        const res = await request({ action: "click", tabId: Number(tabId), selector });
        console.log("Result:", res);

      } else if (cmd === "eval") {
        const tabId = args[0];
        const code = args.slice(1).join(" ");
        if (!tabId || !code) {
          console.log("Usage: eval <tabId> <code>");
          continue;
        }
        const res = await request({ action: "eval", tabId: Number(tabId), code });
        console.log("Eval Output:", res.result || res);

      } else if (cmd === "get_els") {
        const tabId = args[0];
        if (!tabId) {
          console.log("Usage: click <tabId> <selector>");
          continue;
        }
        const res = await request({ action: "get_elements", tabId: Number(tabId)});
        console.log("Result:", res);

      } else if (cmd === "exit" || cmd === "quit") {
        console.log("Goodbye!");
        process.exit(0);

      } else if (cmd) {
        console.log(`Unknown command: ${cmd}`);
      }
    } catch (err) {
      console.error("Communication Error:", err.message);
    }
  }
}

ws.on("open", () => {
  startInteractive();
});

ws.on("error", (err) => {
  console.error("Could not connect to full-server.js. Is it running?");
  process.exit(1);
});

ws.on("close", () => {
  console.log("Connection to server closed.");
  process.exit(0);
});