const path = require('path');
const childProcess = require('child_process');

const HEALTH_TIMEOUT_MS = 1000;

/**
 * Manage the local AI assistant server process: reuse a running one or spawn it.
 * @param {object} opts
 * @param {string} opts.serverDir
 * @param {string} [opts.host]
 * @param {number} [opts.port]
 * @param {string} [opts.nodePath]
 * @param {Function} [opts.spawn]
 * @param {Function} [opts.fetch]
 * @param {number} [opts.startTimeoutMs]
 * @param {number} [opts.pollMs]
 * @returns {{ ensureRunning: () => Promise<object>, status: () => Promise<object>, stop: () => void }}
 */
function createAssistantServerManager({
    serverDir,
    host = '127.0.0.1',
    port = 7071,
    nodePath = 'node',
    spawn = childProcess.spawn,
    fetch = globalThis.fetch,
    startTimeoutMs = 15000,
    pollMs = 500
}) {
    const url = `http://${host}:${port}`;
    let child = null;
    let inFlight = null;

    const notRunning = (error = null) => ({ running: false, url, ready: false, error });

    /** @returns {Promise<object|null>} Status if /health answered, else null. */
    async function probe() {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
        try {
            const res = await fetch(`${url}/health`, { signal: controller.signal });
            if (!res || !res.ok) return null;
            const body = (await res.json()) || {};
            return { running: true, url, ready: body.ready === true, error: body.error ?? null };
        } catch (e) {
            return null;
        } finally {
            clearTimeout(timer);
        }
    }

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    async function start() {
        const existing = await probe();
        if (existing) return existing;

        let failure = null;
        const args = [
            path.join(serverDir, 'packages', 'server', 'src', 'index.js'),
            '--config',
            path.join(serverDir, 'server.config.yaml')
        ];
        try {
            child = spawn(nodePath, args, { cwd: serverDir, windowsHide: true });
        } catch (e) {
            child = null;
            return notRunning(`Could not start assistant server: ${e.message}`);
        }
        const spawned = child;
        spawned.on('error', (e) => {
            failure = failure || e.message;
            if (child === spawned) child = null;
        });
        spawned.on('exit', (code, signal) => {
            failure = failure || `process exited (${signal || code}) before it was ready`;
            if (child === spawned) child = null;
        });

        const deadline = Date.now() + startTimeoutMs;
        while (!failure && Date.now() < deadline) {
            const s = await probe();
            if (s) return s;
            if (failure) break;
            await sleep(pollMs);
        }
        if (!failure) {
            failure = `timed out after ${startTimeoutMs} ms waiting for health`;
            stop();
        }
        return notRunning(`Could not start assistant server: ${failure}`);
    }

    function ensureRunning() {
        if (!inFlight) {
            inFlight = start().finally(() => {
                inFlight = null;
            });
        }
        return inFlight;
    }

    async function status() {
        return (await probe()) || notRunning();
    }

    function stop() {
        if (child) {
            const c = child;
            child = null;
            try {
                c.kill();
            } catch (e) {
                // already gone
            }
        }
    }

    return { ensureRunning, status, stop };
}

module.exports = { createAssistantServerManager };
