import { CopilotClient, SessionEvent } from "@github/copilot-sdk";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import * as os from "node:os";
import * as path from "node:path";

const client = new CopilotClient({ logLevel: "debug" });

const rl = readline.createInterface({ input, output });
let verbose = true

const session = await client.createSession({
    model: "gpt-4.1",
    /* model: "llama3.1-bigctx",
    provider: {
        type: "openai",
        baseUrl: "http://localhost:11434/v1",
        apiKey: "ollama", // Placeholder string
    }, */
    mcpServers: {
        playwright: {
            type: "stdio",
            command: 'npx',
            args: ["-y", "@playwright/mcp@latest"],
            tools: ["*"],
        },
        filesystem: {
            command: "npx",
            args: [
                "-y",
                "@modelcontextprotocol/server-filesystem",
                "${workspaceFolder}",
                path.join(os.tmpdir(), "playwright-mcp-output")
            ],
            tools: ["*"],
        }
    },
    systemMessage: {
        content: "You are a browser automation assistant. DO NOT USE POWERSHELL",
    },
    excludedTools: ["powershell"],
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
            console.log(`\n[tool start] ${toolName}`, verbose ? `id=${toolCallId} args=${JSON.stringify(args)}` : '');
            return;
        }

        case "tool.execution_partial_result": {
            const { toolCallId, partialOutput } = event.data as any;
            console.log(`[tool partial] id=${toolCallId}`, verbose ? `${partialOutput}` : '');
            return;
        }

        case "tool.execution_progress": {
            const { toolCallId, progressMessage } = event.data as any;
            console.log(`[tool progress] id=${toolCallId}`, verbose ? `${progressMessage}` : '');
            return;
        }

        case "tool.execution_complete": {
            const { toolCallId, success, result, error } = event.data as any;
            const output = result?.content ?? error?.message ?? "(no content)";
            console.log(`[tool done] id=${toolCallId} success=${success}\n`, verbose ? `${output}` : '');
            return;
        }

        case "assistant.message":
            console.log(`\n[assistant]\n${event.data.content}`);
            return;

        default:
            // Useful to see what else comes through (kept concise)
            //console.log(`\n[event] ${event.type}`);
            return;
    }
});

async function ask(prompt: string, timeoutMs = 120_000) {
    return session.sendAndWait({ prompt }, timeoutMs);
}

try {
    console.log("Interactive Mode started. Type 'exit' to quit or 'verbose' to toggle logs");
    while (true) {
        const prompt = await rl.question("\nCommand Agent > ");

        if (prompt.toLowerCase() === "exit" || prompt.toLowerCase() === "quit") {
            break;
        }

        if (prompt.toLowerCase() === "verbose") {
            verbose = !verbose
            console.log('verbose mode:', verbose)
            continue;
        }

        if (!prompt.trim()) continue;

        try {
            await ask(prompt);
        } catch (err) {
            console.error(`[Execution Error]: ${(err as Error).message}`);
        }
    }


} finally {
    rl.close();
    await session.destroy();
    await client.stop();
    process.exit(0);
}
