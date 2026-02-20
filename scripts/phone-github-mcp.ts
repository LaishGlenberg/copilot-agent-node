/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * Example: Basic usage of the Copilot SDK
 */
import { CopilotClient } from "@github/copilot-sdk";
import path from "node:path";
import * as readline from "node:readline/promises"; // 1. Add readline import
import { stdin as input, stdout as output } from "node:process";
import 'dotenv/config';
import express from "express";
import cors from "cors";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const screenshotPath = path.resolve("example-home.png");
const screenshotPathJson = screenshotPath.replace(/\\/g, "\\\\"); // windows JSON escape

const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
const scenario = (process.argv[2] ?? "basic").toLowerCase();

const client = new CopilotClient({ logLevel: "debug" });
const rl = readline.createInterface({ input, output }); // 2. Create interface

const session = await client.createSession({
  model: "gpt-4.1",
  /* provider: {
    type: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: OPENAI_API_KEY,
  }, */
  mcpServers: {
    /* everything: {
      type: "stdio",
      command: npxCmd,
      args: ["-y", "@modelcontextprotocol/server-puppeteer"],
      tools: ["*"],
      env: {
        // Launch options must be passed via env for this server
        PUPPETEER_LAUNCH_OPTIONS: JSON.stringify({
          headless: false,
          defaultViewport: { width: 1280, height: 720 },
        }),
        // Only set this if you need dangerous args (e.g., --no-sandbox)
        // ALLOW_DANGEROUS: "true",
      },
    },
    filesystem: {
      type: "stdio",
      command: npxCmd,
      args: ["-y", "@modelcontextprotocol/server-filesystem", process.cwd()],
      tools: ["*"],
    }, */
    /* playwright: {
      type: "stdio",
      command: npxCmd,
      args: ["-y", "@playwright/mcp@latest"],
      tools: ["*"]
    }, */
    browser_extension: {
      type: "stdio",
      command: "node",
      args: [path.resolve("extension", "server-scripts", "full-mcp-server.js")],
      tools: ["browser_get_text", "browser_wait_ready", "browser_list_tabs"]
    },
  },
  systemMessage: {
    content: "You are a browser automation assistant",
  },
  onPermissionRequest: (req) => {
    if (req.kind === "mcp") return { kind: "approved" };
    return { kind: "approved" };
  },
});

session.on((event) => {
  switch (event.type) {
    case "session.info":
      console.log(`\n[session info] ${(event.data as any)?.message ?? ""}`);
      return;

    case "session.error":
      console.log(`\n[session error] ${(event.data as any)?.message ?? ""}`);
      return;

    case "tool.execution_start": {
      const { toolName, toolCallId, arguments: args } = event.data as any;
      console.log(`\n[tool start] ${toolName} id=${toolCallId} args=${JSON.stringify(args)}`);
      return;
    }

    case "tool.execution_partial_result": {
      const { toolCallId, partialOutput } = event.data as any;
      console.log(`[tool partial] id=${toolCallId} ${partialOutput}`);
      return;
    }

    case "tool.execution_progress": {
      const { toolCallId, progressMessage } = event.data as any;
      console.log(`[tool progress] id=${toolCallId} ${progressMessage}`);
      return;
    }

    case "tool.execution_complete": {
      const { toolCallId, success, result, error } = event.data as any;
      const output = result?.content ?? error?.message ?? "(no content)";
      console.log(`[tool done] id=${toolCallId} success=${success}\n${output}`);
      return;
    }

    case "assistant.message":
      console.log(`\n[assistant]\n${event.data.content}`);
      return;

    /* case "assistant.usage":
      console.log(`\n[usage]\n${JSON.stringify(event.data, null, 2)}`);
      return; */

    default:
      // Useful to see what else comes through (kept concise)
      //console.log(JSON.stringify(event, null, 2));
      //${JSON.stringify(event, null, 2)}
      console.log(`\n[event] ${event.type}`);
      return;
  }
});

async function ask(prompt: string, timeoutMs = 120_000) {
  return session.sendAndWait({ prompt }, timeoutMs);
}

async function step(name: string, prompt: string, timeoutMs = 120_000) {
  console.log(`\n=== Step: ${name} ===`);
  try {
    await ask(prompt, timeoutMs);
  } catch (err) {
    console.log(`[step failed] ${name}: ${(err as Error)?.message ?? String(err)}`);
  }
}

// --- Remote Control Server Setup ---
const app = express();
app.use(cors());
app.use(express.json());

const SECRET = "mysecret123";
let busy = false;

app.get("/", (_, res) => {
  res.send(`
    <html>
      <head>
        <title>Remote Agent</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: sans-serif; padding: 20px; max-width: 600px; margin: auto; }
          textarea { width: 100%; height: 100px; margin-bottom: 10px; }
          input { width: 100%; margin-bottom: 10px; padding: 5px; }
          button { padding: 10px 20px; font-size: 1.1em; cursor: pointer; background: #007bff; color: white; border: none; border-radius: 4px; }
          pre { background: #f4f4f4; padding: 10px; overflow-x: auto; white-space: pre-wrap; margin-top: 20px; }
          .checkbox-container { display: flex; align-items: center; margin-bottom: 15px; }
          .checkbox-container input { width: auto; margin-right: 8px; margin-bottom: 0; }
        </style>
      </head>
      <body>
        <h2>🤖 Remote Agent Control</h2>
        <label>Access Token:</label>
        <input id="token" type="password" value="${SECRET}" />
        <label>Prompt:</label>
        <textarea id="cmd" placeholder="e.g. Go to github.com and find the latest news"></textarea>
        <div class="checkbox-container">
          <input type="checkbox" id="clearCheckbox" checked>
          <label for="clearCheckbox">Clear prompt after sending</label>
        </div>
        <button onclick="send()">Send Command</button>
        <pre id="out">Waiting for command...</pre>
        <script>
          async function send() {
            const prompt = document.getElementById("cmd").value;
            const token = document.getElementById("token").value;
            const out = document.getElementById("out");
            const shouldClear = document.getElementById("clearCheckbox").checked;
            
            if (!prompt) return alert("Please enter a prompt");
            
            // Clear the prompt box if checkbox is checked
            if (shouldClear) {
              document.getElementById("cmd").value = "";
            }
            
            out.textContent = "⏳ Agent is processing... Check your computer terminal for logs.";
            try {
              const res = await fetch("/prompt", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt, token })
              });
              const data = await res.json();
              out.textContent = JSON.stringify(data, null, 2);
            } catch (err) {
              out.textContent = "❌ Error: " + err.message;
            }
          }
        </script>
      </body>
    </html>
  `);
});

app.post("/prompt", async (req, res) => {
  const { prompt, token } = req.body;

  if (token !== SECRET) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  if (!prompt) {
    return res.status(400).json({ error: "Missing prompt" });
  }

  if (busy) {
    return res.status(409).json({ error: "Agent is busy (another command is running)" });
  }

  try {
    busy = true;
    console.log(`\n[REMOTE PROMPT RECEIVED]\n${prompt}`);
    
    const result = await ask(prompt);

    busy = false;
    res.json({
      success: true,
      message: "Prompt executed",
      result,
    });
  } catch (err) {
    busy = false;
    res.status(500).json({
      success: false,
      error: (err as Error).message,
    });
  }
});

const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🌍 Remote control server running on http://localhost:${PORT}`);
  console.log(`Access the UI locally at http://localhost:${PORT}`);
});

//192.168.1.16:3000
try {
  console.log(`\n=== Browser Extention MCP Playground (${scenario}) ===\n`);
  step(
      "Verify extension and MCP connection",
      "Call the browser_wait_ready tool to ensure the extension is connected before proceeding."
    );

  if (scenario === "server") {
    console.log("Server mode active. Waiting for remote commands...");
    // Keep the process alive indefinitely
    await new Promise(() => {});
  } else if (scenario === "loop") {
    // 3. New Loop Mode
    console.log("Interactive Mode started. Type 'exit' to quit.");
    while (true) {
      const prompt = await rl.question("\nCommand Agent > ");
      
      if (prompt.toLowerCase() === "exit" || prompt.toLowerCase() === "quit") {
        break;
      }

      if (!prompt.trim()) continue;

      try {
        await ask(prompt);
      } catch (err) {
        console.error(`[Execution Error]: ${(err as Error).message}`);
      }
    }
  } else if (scenario === "basic") {
    // 4. Keep existing Basic mode
    await step(
      "test",
      "what is 5+5?"
    );
  }

} finally {
  rl.close(); // 5. Clean up
  await session.destroy();
  await client.stop();
  process.exit(0);
}