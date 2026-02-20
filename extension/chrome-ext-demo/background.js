let socket = null;
let isRunning = false;
let heartbeatInterval = null;

async function connect() {
    if (!isRunning) return;

    // Close existing if any
    if (socket) {
        socket.onclose = null;
        socket.close();
    }

    socket = new WebSocket("ws://localhost:8787");

    socket.onopen = () => {
        console.log("Connected to MCP server");
    };

    socket.onclose = () => {
        console.log("Disconnected from MCP server.");
        if (isRunning) {
            console.log("Retrying in 3s...");
            setTimeout(connect, 3000);
        }
    };

    socket.onerror = (err) => {
        console.error("WebSocket error:", err);
        socket.close();
    };

    socket.onmessage = async (event) => {
        const msg = JSON.parse(event.data);
        const { id, action } = msg;

        try {
            if (action === "list_tabs") {
                const tabs = await chrome.tabs.query({});
                socket.send(JSON.stringify({
                    id,
                    result: tabs.map(t => ({ id: t.id, url: t.url, title: t.title }))
                }));
            }

            if (action === "click") {
                const { tabId, selector } = msg;
                await chrome.scripting.executeScript({
                    target: { tabId },
                    func: (sel) => {
                        const el = document.querySelector(sel);
                        if (!el) throw new Error("Element not found: " + sel);
                        el.click();
                    },
                    args: [selector]
                });
                socket.send(JSON.stringify({ id, result: "ok" }));
            }

            if (action === "eval") {
                const { tabId, code } = msg;
                const results = await chrome.scripting.executeScript({
                    target: { tabId: Number(tabId) },
                    func: (input) => {
                        try {
                            const parts = input.trim().split('.');
                            let target = window;
                            let parent = null;
                            for (let i = 0; i < parts.length; i++) {
                                let part = parts[i];
                                let args = null;
                                const match = part.match(/^(\w+)\((.*)\)$/);
                                if (match) {
                                    part = match[1];
                                    args = match[2] ? match[2].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')) : [];
                                }
                                parent = target;
                                target = target[part];
                                if (args !== null) {
                                    target = target.apply(parent, args);
                                }
                                if (target === undefined) throw new Error(`${part} is undefined`);
                            }
                            if (target instanceof Node) return target.textContent;
                            if (typeof target === 'object') return JSON.stringify(target);
                            return target;
                        } catch (e) {
                            return "Bridge Error: " + e.message;
                        }
                    },
                    args: [code]
                });

                socket.send(JSON.stringify({
                    id,
                    result: results[0]?.result
                }));
            }

            if (action === "get_elements") {
                const { tabId } = msg;
                const results = await chrome.scripting.executeScript({
                    target: { tabId: Number(tabId) },
                    func: () => {
                        // Find all common interactive elements
                        const elements = document.querySelectorAll('button, a, input[type="button"], input[type="submit"]');
                        return Array.from(elements).map(el => {
                            // Generate a "good enough" selector
                            const selector = el.id ? `#${el.id}` :
                                el.className ? `.${el.className.trim().split(/\s+/).join('.')}` :
                                    el.tagName.toLowerCase();
                            return {
                                tag: el.tagName.toLowerCase(),
                                text: el.innerText.trim().substring(0, 50),
                                id: el.id,
                                selector: selector,
                                ariaLabel: el.getAttribute('aria-label')
                            };
                        }).filter(item => item.text || item.ariaLabel || item.id); // Filter out empty noise
                    }
                });
                socket.send(JSON.stringify({ id, result: results[0]?.result }));
            }
            
        } catch (err) {
            console.error("Action handler error:", err);
            if (socket && socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ id, error: err.message }));
            }
        }
    };
}

function startHeartbeat() {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
        if (!isRunning) {
            clearInterval(heartbeatInterval);
            return;
        }
        // Keep worker alive
        chrome.tabs.query({ active: true }, () => { });

        // Send heartbeat if socket is open
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "heartbeat" }));
        }
    }, 20000);
}

function stopHeartbeat() {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = null;
}

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "start") {
        isRunning = true;
        chrome.storage.local.set({ isRunning: true });
        startHeartbeat();
        connect();
        sendResponse({ status: "started" });
    } else if (message.action === "stop") {
        isRunning = false;
        chrome.storage.local.set({ isRunning: false });
        stopHeartbeat();
        if (socket) {
            socket.onclose = null;
            socket.close();
            socket = null;
        }
        sendResponse({ status: "stopped" });
    }
});

// Initialize on load (if it was running before)
chrome.storage.local.get(['isRunning'], (res) => {
    if (res.isRunning) {
        isRunning = true;
        startHeartbeat();
        connect();
    }
});