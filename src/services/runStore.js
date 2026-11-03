const MAX_RUNS = 10;

/** In-memory store of opened test runs (main process). Cleared when the run window closes. */
const runs = new Map();
let counter = 0;

/**
 * Register a run that has just been opened.
 * @param {{ id?: string, app: string, branch?: string }} info
 * @returns {string} run id
 */
function register({ id, app, branch } = {}) {
    counter += 1;
    const runId = id || `run-${Date.now()}-${counter}`;
    runs.delete(runId);
    runs.set(runId, {
        id: runId,
        app: app || '',
        branch: branch || '',
        status: 'running',
        startedAt: Date.now(),
        finishedAt: null,
        error: null,
        tests: null,
        coverage: null,
        files: []
    });
    while (runs.size > MAX_RUNS) {
        runs.delete(runs.keys().next().value);
    }
    return runId;
}

/**
 * Mark a run finished with its results.
 * @param {string} id
 * @param {{ tests?: object, coverage?: object, files?: object[] }} result
 * @returns {boolean} false when the run is unknown
 */
function complete(id, result = {}) {
    const run = runs.get(id);
    if (!run) return false;
    run.status = 'done';
    run.finishedAt = Date.now();
    run.error = null;
    run.tests = result.tests || null;
    run.coverage = result.coverage || null;
    run.files = Array.isArray(result.files) ? result.files : [];
    return true;
}

/**
 * Mark a run failed.
 * @param {string} id
 * @param {string} message
 * @returns {boolean}
 */
function fail(id, message) {
    const run = runs.get(id);
    if (!run) return false;
    run.status = 'error';
    run.finishedAt = Date.now();
    run.error = String(message || 'Run failed');
    return true;
}

function remove(id) {
    return runs.delete(id);
}

function get(id) {
    return runs.get(id);
}

/** @returns {object[]} runs, newest first */
function list() {
    return Array.from(runs.values()).reverse();
}

module.exports = { register, complete, fail, remove, get, list, MAX_RUNS };
