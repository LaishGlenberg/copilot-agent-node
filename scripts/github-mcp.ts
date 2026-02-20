/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * Example: Basic usage of the Copilot SDK
 */
import { CopilotClient, SessionEvent } from "@github/copilot-sdk";
import path from "node:path";
import * as readline from "node:readline/promises"; // 1. Add readline import
import { stdin as input, stdout as output } from "node:process";
import 'dotenv/config';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
console.log(OPENAI_API_KEY)
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
    } */
    browser_extension: {
      type: "stdio",
      command: "node",
      args: [path.resolve("extension", "server-scripts", "full-mcp-server.js")],
      tools: ["*"]
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

session.on((event: SessionEvent) => {
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

try {
  console.log(`\n=== Browser Extention MCP Playground (${scenario}) ===\n`);

  if (scenario === "loop") {
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
    /* await step(
      "test",
      "what is 5+5?"
    ); */
    await step(
      "ready",
      "Call the browser_wait_ready tool to ensure the extension is connected before proceeding."
    );
    await step(
      "1",
      "using the browser extension find the trello board and get its text"
    );
    await step(
      "2",
      "summarize the trello board"
    );
  }

} finally {
  rl.close(); // 5. Clean up
  await session.destroy();
  await client.stop();
  process.exit(0);
}

/* await step(
      "navigate",
      'Call the MCP tool "puppeteer_navigate" with {"url":"https://example.com"} and reply "ok".'
    );

    await step(
      "screenshot",
      `Call "puppeteer_screenshot" with {"name":"example-home","fullPage":true,"encoded":false} Then, use the filesystem "write_file" tool to save the image to "${screenshotPathJson}". DO NOT OUTPUT ANY BASE64`
    );

    await step(
      "evaluate",
      'Call the MCP tool "puppeteer_evaluate" with {"script":"document.documentElement.outerHTML.slice(0,2000)"} and reply with the result.'
    ); */