const fs = require('fs');
const path = require('path');

/**
 * Per-repo command logs under <project>/logs/.
 * Creates a new file when missing; appends when the file already exists.
 */

/**
 * Resolve the logs directory (project root /logs).
 * @returns {string}
 */
function getLogsDirectory() {
    if (process.env.CODE_ANALYZER_LOGS_DIR) {
        return path.resolve(process.env.CODE_ANALYZER_LOGS_DIR);
    }
    return path.join(__dirname, '..', '..', 'logs');
}

/**
 * Sanitize repo name for use as a log filename.
 * @param {string} repoName
 * @returns {string}
 */
function sanitizeRepoFileName(repoName) {
    const base = String(repoName || 'unknown-repo')
        .trim()
        .replace(/[<>:"/\\|?*]/g, '_');
    return base || 'unknown-repo';
}

/**
 * Path to the log file for a repository.
 * @param {string} repoName
 * @returns {string}
 */
function getRepoLogFilePath(repoName) {
    return path.join(getLogsDirectory(), `${sanitizeRepoFileName(repoName)}.log`);
}

/**
 * Mask tokens and passwords in log text.
 * @param {string} text
 * @param {{ token?: string, username?: string }|null} [credentials]
 * @returns {string}
 */
function maskSecretsInText(text, credentials = null) {
    let out = String(text || '');
    if (credentials?.token) {
        out = out.split(credentials.token).join('****');
    }
    if (credentials?.username) {
        out = out.split(credentials.username).join('****');
    }
    try {
        out = out.replace(/:\/\/([^:@/]+):([^@/]+)@/g, '://$1:****@');
    } catch {
        // ignore
    }
    return out;
}

/**
 * Mask sensitive args in a command line (URLs with credentials).
 * @param {string} command
 * @returns {string}
 */
function maskCommandLine(command) {
    return command.replace(/:\/\/([^:@/]+):([^@/]+)@/g, '://$1:****@');
}

/**
 * Infer repository name from working directory (git root or folder basename).
 * @param {string} cwd
 * @returns {string}
 */
function resolveRepoNameFromCwd(cwd) {
    let current = path.resolve(cwd || process.cwd());
    const root = path.parse(current).root;

    while (current !== root) {
        if (fs.existsSync(path.join(current, '.git'))) {
            return path.basename(current);
        }
        current = path.dirname(current);
    }

    return path.basename(path.resolve(cwd || process.cwd())) || 'unknown-repo';
}

/** Max bytes of Jest stdout/stderr written per command to repo logs. */
const JEST_LOG_TAIL_BYTES = 8192;

/**
 * Keep the last N bytes of a string (UTF-8 safe enough for logs).
 * @param {string} text
 * @param {number} maxBytes
 * @returns {string}
 */
function truncateLogTail(text, maxBytes = JEST_LOG_TAIL_BYTES) {
    const s = String(text || '');
    if (Buffer.byteLength(s, 'utf8') <= maxBytes) {
        return s;
    }
    let low = 0;
    let high = s.length;
    while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        const slice = s.slice(s.length - mid);
        if (Buffer.byteLength(slice, 'utf8') <= maxBytes) {
            low = mid;
        } else {
            high = mid - 1;
        }
    }
    const tail = s.slice(s.length - low);
    return `[...truncated, last ${low} chars]\n${tail}`;
}

/**
 * Classify failure type from command output for log summaries.
 * @param {string} commandType - git | npm | jest | junction
 * @param {string} stderr
 * @param {string} stdout
 * @param {number|null} exitCode
 * @param {string} [spawnError]
 * @returns {string}
 */
function classifyCommandError(commandType, stderr, stdout, exitCode, spawnError) {
    if (spawnError) {
        return 'SPAWN_ERROR';
    }
    if (exitCode === 0 || exitCode === null) {
        return 'NONE';
    }

    const combined = `${stderr}\n${stdout}`.toLowerCase();

    if (commandType === 'junction') {
        if (/eperm|privilege|access is denied|symlink|junction/i.test(combined)) {
            return 'JUNCTION_PERMISSION';
        }
        return 'JUNCTION_ERROR';
    }

    if (commandType === 'npm') {
        if (/enotfound|etimedout|network|econnrefused/i.test(combined)) {
            return 'NPM_NETWORK';
        }
        if (/eacces|eperm/i.test(combined)) {
            return 'NPM_PERMISSION';
        }
        return 'NPM_INSTALL_FAILED';
    }

    if (commandType === 'jest') {
        if (/test suites:.*failed|tests:.*failed/i.test(combined)) {
            return 'JEST_TEST_FAILURE';
        }
        if (/cannot find module|module not found/i.test(combined)) {
            return 'JEST_MODULE_RESOLUTION';
        }
        if (/heap out of memory|oom/i.test(combined)) {
            return 'JEST_OOM';
        }
        return 'JEST_RUN_FAILED';
    }

    if (/authentication failed|invalid credentials|401|403|denied|permission denied/i.test(combined)) {
        return 'GIT_AUTH';
    }
    if (/could not read from remote|failed to connect|connection timed out|unable to access|host not found|enotfound/i.test(combined)) {
        return 'GIT_NETWORK';
    }
    if (/unknown revision|did not match any file|branch.*not found/i.test(combined)) {
        return 'GIT_BRANCH';
    }
    if (/merge conflict|conflict/i.test(combined)) {
        return 'GIT_MERGE_CONFLICT';
    }
    if (/already exists and is not an empty directory/i.test(combined)) {
        return 'GIT_CLONE_EXISTS';
    }

    return 'GIT_COMMAND_FAILED';
}

/**
 * Append text to a repo log file (create file and logs dir if needed).
 * @param {string} repoName
 * @param {string} chunk
 */
function appendToRepoLog(repoName, chunk) {
    const logPath = getRepoLogFilePath(repoName);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const exists = fs.existsSync(logPath);
    fs.appendFileSync(logPath, chunk, 'utf8');
    if (!exists) {
        console.log(`[RepoLog] Created log file: ${logPath}`);
    }
}

/**
 * Start a new logged session for a repository (append session header).
 * @param {string} repoName
 * @param {object} [meta]
 */
function beginRepoLogSession(repoName, meta = {}) {
    const lines = [
        '',
        '='.repeat(80),
        `SESSION START ${new Date().toISOString()}`,
        `Repo: ${repoName}`
    ];

    for (const [key, value] of Object.entries(meta)) {
        if (value !== undefined && value !== null) {
            lines.push(`${key}: ${maskCommandLine(String(value))}`);
        }
    }

    lines.push('='.repeat(80), '');
    appendToRepoLog(repoName, `${lines.join('\n')}\n`);
}

/**
 * Log a single command execution for a repository.
 * @param {object} entry
 * @param {string} entry.repoName
 * @param {string} [entry.commandType] - git | npm | jest | junction
 * @param {string} entry.command - Full command line shown in log
 * @param {string} [entry.cwd]
 * @param {boolean} [entry.success]
 * @param {number|null} [entry.exitCode]
 * @param {string} [entry.stdout]
 * @param {string} [entry.stderr]
 * @param {string} [entry.spawnError]
 * @param {number} [entry.durationMs]
 * @param {{ token?: string, username?: string }|null} [entry.credentials]
 */
function logRepoCommand(entry) {
    const {
        repoName,
        commandType = 'command',
        command,
        cwd = '',
        success = false,
        exitCode = null,
        stdout = '',
        stderr = '',
        spawnError = '',
        durationMs = 0,
        credentials = null
    } = entry;

    const errorType = classifyCommandError(
        commandType,
        stderr,
        stdout,
        exitCode,
        spawnError || undefined
    );
    const statusLabel = success ? 'SUCCESS' : 'FAILED';
    const safeCommand = maskCommandLine(command);
    let safeStdout = maskSecretsInText(stdout, credentials);
    let safeStderr = maskSecretsInText(
        spawnError ? `${stderr}\n[spawn] ${spawnError}` : stderr,
        credentials
    );
    if (commandType === 'jest') {
        safeStdout = truncateLogTail(safeStdout, JEST_LOG_TAIL_BYTES);
        safeStderr = truncateLogTail(safeStderr, JEST_LOG_TAIL_BYTES);
    }

    const block = [
        '-'.repeat(80),
        `[${new Date().toISOString()}] ${commandType.toUpperCase()} | ${statusLabel} (exit ${exitCode ?? 'n/a'}) | ${durationMs}ms`,
        `CWD: ${cwd}`,
        `Command: ${safeCommand}`,
        `Error type: ${errorType}`,
        '',
        '--- STDOUT ---',
        safeStdout || '(empty)',
        '',
        '--- STDERR ---',
        safeStderr || '(empty)',
        '-'.repeat(80),
        ''
    ].join('\n');

    appendToRepoLog(repoName, block);
}

module.exports = {
    getLogsDirectory,
    getRepoLogFilePath,
    sanitizeRepoFileName,
    resolveRepoNameFromCwd,
    maskSecretsInText,
    maskCommandLine,
    classifyCommandError,
    beginRepoLogSession,
    logRepoCommand,
    appendToRepoLog,
    truncateLogTail,
    JEST_LOG_TAIL_BYTES
};
