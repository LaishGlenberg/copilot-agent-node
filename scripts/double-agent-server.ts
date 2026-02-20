/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * Multi-agent orchestration using GPT-4.1 for retrieval and GPT-5-mini for reasoning.
 */
import { CopilotClient, defineTool, type SessionEvent } from "@github/copilot-sdk";
import path from "node:path";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import 'dotenv/config';
import express from "express";
import cors from "cors";
import chalk from 'chalk';

const scenario = (process.argv[2] ?? "basic").toLowerCase();
const client = new CopilotClient({ logLevel: "debug" });
const rl = readline.createInterface({ input, output });

let premium_reqs = 0
const checkPremiumReqs = (premium_interactions: any) => {
    if (premium_reqs < 1)
        premium_reqs = premium_interactions.usedRequests;
    else if (premium_interactions.usedRequests !== premium_reqs)
        throw new Error('PREMIUM REQUESTS INCREASED')
}

// 1. Create the Reasoning Session (GPT-5-mini)
const reasoningSession = await client.createSession({
    model: "gpt-5-mini",
    streaming: true,
    systemMessage: {
        mode: "replace", //clean slate no context injected by copilot sdk/cli
        content: "You are a helpful assistant who answers quiz questions"
    }
});

// 2. Create the main Worker Session (GPT-4.1)
const session = await client.createSession({
    model: "gpt-4.1",
    streaming: true,
    mcpServers: {
        browser_extension: {
            type: "stdio",
            command: "node",
            args: [path.resolve("extension", "server-scripts", "full-mcp-server.js")],
            tools: ["browser_get_text", "browser_wait_ready", "browser_list_tabs"]
        },
    },
    tools: [
        defineTool(
            "reason_with_gpt5",
            {
                description: "Send extracted quiz question to gpt-5-mini",
                parameters: {
                    type: "object",
                    properties: {
                        data: { type: "string", description: "the extracted and parsed quiz question" },
                        //userQuery: { type: "string", description: "The original question the user is trying to answer" }
                    },
                    required: ["data", /* "userQuery" */]
                },
                handler: async ({ data, /* userQuery */ }: { data: string; /* userQuery: string */ }) => {
                    console.log("\n[Handing off to GPT-5-mini for reasoning...]");
                    const response = await reasoningSession.sendAndWait({
                        //prompt: `User Query: "${userQuery}"\n\nExtracted Web Data:\n${data}`
                        prompt: `Respond with the answer to this quiz question:\n\n${data}`
                    });
                    //return response?.data.content ?? "Reasoning model failed to provide a response.";
                    return "tool call successful, now give your personal answer to the question"
                }
            }
        )
    ],
    systemMessage: {
        content: "Your job is to use the browser extension mcp tools to extract quiz questions, then feed these questions to the 'reason_with_gpt5' tool",
    },
    onPermissionRequest: (req) => {
        return { kind: "approved" };
    },
});

const event_switch = (event: SessionEvent, model_name: string = "[GPT-4.1 Specialist Output]", indent: string = "") => {
    switch (event.type) {
        case "session.info":
            console.log(`\n${indent}[session info] ${(event.data as any)?.message ?? ""}`);
            break;
        case "session.error":
            console.log(`\n${indent}[session error] ${(event.data as any)?.message ?? ""}`);
            break;
        case "tool.execution_start": {
            const { toolName, toolCallId, arguments: args } = event.data as any;
            console.log(`\n${indent}[tool start] ${toolName} id=${toolCallId} args=${JSON.stringify(args)}`);
            break;
        }
        case "tool.execution_complete": {
            const { toolCallId, success } = event.data as any;
            console.log(`\n${indent}[tool done] id=${toolCallId} success=${success}`);
            break;
        }
        /* case "assistant.message":
            console.log(`\n${indent}${model_name}\n${event.data.content}`);
            break; */
        case "assistant.message_delta":
            //console.log(`\n${indent}${model_name}`)
            process.stdout.write(chalk.green(event.data.deltaContent));
            break;
        case "assistant.usage":
            const { model, inputTokens, cacheReadTokens, duration, premium_interactions } = event.data as any;
            //checkPremiumReqs(premium_interactions)

            console.log(`\n${indent}[usage] model=${model} inputTokens=${inputTokens} cacheReadTokens=${cacheReadTokens} duration=${duration}\n`);
            //console.log('model: ', event.data.model);
            //console.log(JSON.stringify(event.data, null, 2))
            return;

        default:
            // Useful to see what else comes through (kept concise)
            //console.log(JSON.stringify(event, null, 2));
            //console.log(`\n[event] ${event.type}`);
            return;
    }
}

// Logging for the Reasoning Agent
reasoningSession.on((event: SessionEvent) => {
    /* if (event.type === "assistant.message") {
        console.log(`\n[GPT-5-mini Reasoner Output]\n${event.data.content}`);
    } */

    event_switch(event, "[GPT-5-mini Reasoner Output]", "    ");
});

// Logging for the Specialist Agent
session.on((event: SessionEvent) => {
    event_switch(event);
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
const DEFAULT_TEXT = "using the browser extention find the module 13 knowledge check tab, extract the quiz question, and use reason_with_gpt5 to answer the quiz question"
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
        <textarea id="cmd" placeholder="e.g. Go to github.com and find the latest news">${DEFAULT_TEXT}</textarea>
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
    if (token !== SECRET) return res.status(403).json({ error: "Unauthorized" });
    if (!prompt) return res.status(400).json({ error: "Missing prompt" });
    if (busy) return res.status(409).json({ error: "Agent is busy" });

    try {
        busy = true;
        console.log(`\n[REMOTE PROMPT RECEIVED]\n${prompt}`);
        const result = await ask(prompt);
        busy = false;
        res.json({ success: true, result });
    } catch (err) {
        busy = false;
        res.status(500).json({ success: false, error: (err as Error).message });
    }
});

const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🌍 Server active at http://localhost:${PORT}`);
});

try {
    console.log(`\n=== Browser Multi-Agent Playground (${scenario}) ===\n`);

    await step("Init", "Call browser_wait_ready to ensure the browser extension is active.");

    if (scenario === "server") {
        console.log("Waiting for remote commands...");
        await new Promise(() => { });
    } else if (scenario === "loop") {
        console.log("Interactive Mode. Type 'exit' to quit.");
        while (true) {
            const prompt = await rl.question("\nCommand Agent > ");
            if (["exit", "quit"].includes(prompt.toLowerCase())) break;
            if (!prompt.trim()) continue;
            try { await ask(prompt); } catch (err) { console.error(`Error: ${(err as Error).message}`); }
        }
    } else {
        await step("Demo", "using the browser extention find the module 13 knowledge check tab, extract the quiz question, and use reason_with_gpt5 to answer the quiz question");
    }
} finally {
    rl.close();
    if (session) await session.destroy();
    if (reasoningSession) await reasoningSession.destroy();
    await client.stop();
    process.exit(0);
}