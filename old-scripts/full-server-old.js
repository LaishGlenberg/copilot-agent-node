import { WebSocketServer } from "ws";

const extWss = new WebSocketServer({ port: 8787 });
const controlWss = new WebSocketServer({ port: 8888 });

let extensionSocket = null;

// Handle Extension Connection
extWss.on("connection", (ws) => {
  console.log(">>> Extension connected on 8787");
  extensionSocket = ws;

  ws.on("close", () => {
    console.log("<<< Extension disconnected");
    if (extensionSocket === ws) {
      extensionSocket = null;
    }
  });

  ws.on("error", (err) => {
    console.error("Extension socket error:", err);
  });

  ws.on("message", (msg) => {
    const data = JSON.parse(msg.toString());
    if (data.type === "heartbeat") {
      console.log('heartbeat')
    } // Ignore heartbeats
    // ... rest of your logic
  });
});

// Handle Control Connections (from your 2nd script)
controlWss.on("connection", (controlWs) => {
  console.log("--- Control script connected on 8888");

  controlWs.on("message", async (msg) => {
    console.log("Received command from control script...");
    
    if (!extensionSocket || extensionSocket.readyState !== 1) { // 1 = OPEN
      console.log("Error: Extension not active");
      controlWs.send(JSON.stringify({ 
        error: "No extension connected", 
        socketExists: !!extensionSocket,
        readyState: extensionSocket ? extensionSocket.readyState : 'N/A'
      }));
      return;
    }

    try {
      const command = JSON.parse(msg.toString());
      const res = await sendToExtension(command);
      controlWs.send(JSON.stringify(res));
    } catch (err) {
      controlWs.send(JSON.stringify({ error: err.message }));
    }
  });
});

function sendToExtension(command) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const payload = { id, ...command };
    
    const timeout = setTimeout(() => {
      extensionSocket.off("message", handler);
      reject(new Error("Extension response timed out"));
    }, 5000);

    const handler = (msg) => {
      const res = JSON.parse(msg.toString());
      if (res.id === id) {
        clearTimeout(timeout);
        extensionSocket.off("message", handler);
        resolve(res);
      }
    };

    extensionSocket.on("message", handler);
    extensionSocket.send(JSON.stringify(payload));
  });
}

console.log("Waiting for extension (ws://localhost:8787) and commands (ws://localhost:8888)...");