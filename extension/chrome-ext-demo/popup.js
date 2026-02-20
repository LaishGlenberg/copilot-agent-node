const stateText = document.getElementById('stateText');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');

function updateUI(isRunning) {
    stateText.textContent = isRunning ? "Running" : "Stopped";
    stateText.className = isRunning ? "running" : "stopped";
    startBtn.disabled = isRunning;
    stopBtn.disabled = !isRunning;
}

// Get current state on open
chrome.storage.local.get(['isRunning'], (res) => {
    updateUI(!!res.isRunning);
});

startBtn.onclick = () => {
    chrome.runtime.sendMessage({ action: "start" }, () => {
        updateUI(true);
    });
};

stopBtn.onclick = () => {
    chrome.runtime.sendMessage({ action: "stop" }, () => {
        updateUI(false);
    });
};