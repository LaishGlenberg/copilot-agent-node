import { WebSocketServer } from "ws";
import crypto from "crypto";

/* =========================
   EXTENSION SOCKET (UNCHANGED)
   ========================= */

const extWss = new WebSocketServer({ port: 8787 });
let extensionSocket = null;

extWss.on("connection", (ws) => {
    console.error(">>> Extension connected on 8787");
    extensionSocket = ws;

    ws.on("close", () => {
        if (extensionSocket === ws) extensionSocket = null;
        console.error("<<< Extension disconnected");
    });

    ws.on("message", (msg) => {
        const data = JSON.parse(msg.toString());
        if (data.type === "heartbeat") return;
    });
});

async function sendToExtension(command) {
    // Wait for extension connection if it's not ready yet
    let attempts = 0;
    while (!extensionSocket || extensionSocket.readyState !== 1) {
        if (attempts >= 10) {
            throw new Error("Extension not connected after 10 seconds. Please ensure the extension is active and connected to ws://localhost:8787");
        }
        console.error(`>>> Waiting for extension connection... (attempt ${attempts + 1}/10)`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        attempts++;
    }

    return new Promise((resolve, reject) => {
        if (!extensionSocket || extensionSocket.readyState !== 1) {
            reject(new Error("Extension not connected, try again in a few seconds"));
            return;
        }

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

/* =========================
   MCP STDIO SERVER
   ========================= */

process.stdin.setEncoding("utf8");

process.stdin.on("data", async (chunk) => {
    const lines = chunk.split("\n").filter(Boolean);

    for (const line of lines) {
        let msg;
        try {
            msg = JSON.parse(line);
        } catch {
            continue;
        }

        const { id, method, params } = msg;

        try {
            /* ---------- initialize ---------- */
            if (method === "initialize") {
                respond(id, {
                    protocolVersion: "2024-11-05",
                    capabilities: {
                        tools: {
                            list: true,
                            call: true
                        }
                    },
                    serverInfo: {
                        name: "browser-extension-mcp",
                        version: "0.1.0"
                    }
                });
                continue;
            }

            /* ---------- tools/list ---------- */
            if (method === "tools/list") {
                respond(id, {
                    tools: [
                        {
                            name: "browser_wait_ready",
                            description: "Wait until the browser extension is connected and ready to receive commands",
                            inputSchema: { type: "object", properties: {} }
                        },
                        {
                            name: "browser_list_tabs",
                            description: "List all open browser tabs",
                            inputSchema: { type: "object", properties: {} }
                        },
                        {
                            name: "browser_click",
                            description: "Click a DOM element in a tab",
                            inputSchema: {
                                type: "object",
                                properties: {
                                    tabId: { type: "number" },
                                    selector: { type: "string" }
                                },
                                required: ["tabId", "selector"]
                            }
                        },
                        {
                            name: "browser_eval",
                            description: "Evaluate a safe expression in a tab",
                            inputSchema: {
                                type: "object",
                                properties: {
                                    tabId: { type: "number" },
                                    code: { type: "string" }
                                },
                                required: ["tabId", "code"]
                            }
                        },
                        {
                            name: "browser_get_elements",
                            description: "Get a list of interactive elements (buttons, links) in a tab",
                            inputSchema: {
                                type: "object",
                                properties: {
                                    tabId: { type: "number" }
                                },
                                required: ["tabId"]
                            }
                        },
                        {
                            name: "browser_get_text",
                            description: "Get the inner text of the tab",
                            inputSchema: {
                                type: "object",
                                properties: {
                                    tabId: { type: "number" }
                                },
                                required: ["tabId"]
                            }
                        }
                    ]
                });
                continue;
            }

            /* ---------- tools/call ---------- */
            if (method === "tools/call") {
                const { name, arguments: args } = params;

                let result;

                if (name === "browser_wait_ready") {
                    // This will naturally trigger the wait logic inside sendToExtension
                    result = await sendToExtension({ action: "browser_wait_ready" });
                }

                else if (name === "browser_list_tabs") {
                    result = await sendToExtension({ action: "list_tabs" });
                }

                else if (name === "browser_click") {
                    result = await sendToExtension({
                        action: "click",
                        tabId: args.tabId,
                        selector: args.selector
                    });
                }

                else if (name === "browser_eval") {
                    result = await sendToExtension({
                        action: "eval",
                        tabId: args.tabId,
                        code: args.code
                    });
                }

                else if (name === "browser_get_elements") {
                    result = await sendToExtension({ action: "get_elements", tabId: args.tabId });
                }

                else if (name === "browser_get_text") {
                    result = await sendToExtension({
                        action: "eval",
                        tabId: args.tabId,
                        code: 'document.body.innerText'
                    });
                }

                else {
                    throw new Error(`Unknown tool: ${name}`);
                }

                respond(id, {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(result.result ?? result)
                        }
                    ]
                });
                continue;
            }

        } catch (err) {
            respondError(id, err.message);
        }
    }
});

function respond(id, result) {
    process.stdout.write(JSON.stringify({
        jsonrpc: "2.0",
        id,
        result
    }) + "\n");
}

function respondError(id, message) {
    process.stdout.write(JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: {
            code: -32000,
            message
        }
    }) + "\n");
}

console.error("MCP Browser Automation Server ready (stdio)");
console.error("Waiting for extension on ws://localhost:8787");
