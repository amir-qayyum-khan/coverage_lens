const fs = require('fs');
const path = require('path');
const {
    buildJunctionsByRepoFolder,
    buildSourceRootByRepoFolder,
    normalizeAppJunctions,
    repoFolderKeyFromUrl,
    JUNCTIONS_CORE,
    JUNCTIONS_STANDARD
} = require('../data/appsCatalog');
const { beginRepoLogSession, logRepoCommand } = require('../utils/repoCommandLogger');

/** Derived labels for callers/tests: core = includes we-track; standard = we-common + we-framework. */
const JUNCTION_PROFILE_CORE = 'core';
const JUNCTION_PROFILE_STANDARD = 'standard';

/** Registry of all known junction link specs. */
const TRAPEZE_JUNCTION_SPECS = [
    {
        linkName: 'we-common',
        repoName: 'TrapezeDRTCommonUI',
        targetSubPath: ['source', 'src']
    },
    {
        linkName: 'we-framework',
        repoName: 'TrapezeFrameworkUI',
        targetSubPath: ['source', 'src']
    },
    {
        linkName: 'we-track',
        repoName: 'TrapezeDRTWeTrackUI',
        targetSubPath: ['src']
    }
];

const TRAPEZE_JUNCTION_SPECS_STANDARD = TRAPEZE_JUNCTION_SPECS.filter(
    (s) => s.linkName === 'we-common' || s.linkName === 'we-framework'
);

const JUNCTION_SPEC_BY_LINK_NAME = Object.fromEntries(
    TRAPEZE_JUNCTION_SPECS.map((spec) => [spec.linkName, spec])
);

const DEFAULT_GITEA_SSH_BASE = 'gitea@git.we-support.se:Trapeze';
const CORE_UI_REPO_BASENAME = 'TrapezeDRTCoreUI';

/**
 * Fixed branch for a sibling when the UI repo uses developV2 (Framework has no developV2).
 * null = follow the active UI branch.
 */
const SIBLING_BRANCH_BY_REPO = {
    TrapezeFrameworkUI: 'develop',
    TrapezeDRTWeTrackUI: 'develop-we'
};

/** Ordered fallbacks when the preferred branch is missing on the remote. */
const SIBLING_BRANCH_FALLBACKS = ['developV2', 'develop-we', 'develop'];

/** Sibling repos that supply junction targets — clones of these do not need junction setup. */
const JUNCTION_SOURCE_REPO_FOLDERS = new Set([
    'TrapezeDRTCommonUI',
    'TrapezeFrameworkUI',
    'TrapezeDRTWeTrackUI'
]);

/** Catalog folder → configured junction link names. */
const JUNCTIONS_BY_REPO_FOLDER = buildJunctionsByRepoFolder();

/** Catalog folder → relative source root override (e.g. DriverCom → source/UI/src). */
const SOURCE_ROOT_BY_REPO_FOLDER = buildSourceRootByRepoFolder();

/**
 * Legacy profile map derived from catalog junctions (core if we-track, else standard).
 * @returns {Record<string, 'core'|'standard'>}
 */
function buildJunctionProfileByRepoFolder() {
    const map = {};
    for (const [folder, links] of Object.entries(JUNCTIONS_BY_REPO_FOLDER)) {
        map[folder] = links.includes('we-track') ? JUNCTION_PROFILE_CORE : JUNCTION_PROFILE_STANDARD;
    }
    return map;
}

const JUNCTION_PROFILE_BY_REPO_FOLDER = buildJunctionProfileByRepoFolder();

/**
 * Junction link specs for an ordered list of link names.
 * @param {string[]} linkNames
 * @returns {{ linkName: string, repoName: string, targetSubPath: string[] }[]}
 */
function getJunctionSpecsForLinks(linkNames) {
    const names = normalizeAppJunctions(linkNames);
    return names
        .map((name) => JUNCTION_SPEC_BY_LINK_NAME[name])
        .filter(Boolean)
        .map((spec) => ({ ...spec }));
}

/**
 * Junction link specs for a legacy profile name.
 * @param {'core'|'standard'} profile
 * @returns {{ linkName: string, repoName: string, targetSubPath: string[] }[]}
 */
function getJunctionSpecsForProfile(profile) {
    const links = profile === JUNCTION_PROFILE_CORE ? JUNCTIONS_CORE : JUNCTIONS_STANDARD;
    return getJunctionSpecsForLinks(links);
}

/**
 * Return the three sibling repo definitions for Trapeze Core UI junction setup.
 * @returns {{ linkName: string, repoName: string, targetSubPath: string[] }[]}
 */
function getTrapezeSiblingRepos() {
    return getJunctionSpecsForLinks(JUNCTIONS_CORE);
}

/**
 * Resolve configured junction link names for a clone (catalog first, then heuristics).
 * @param {string} clonePath
 * @param {string|null} [repoUrl]
 * @returns {string[]}
 */
function getConfiguredJunctionLinkNames(clonePath, repoUrl = null) {
    const base = path.basename(clonePath);
    if (JUNCTIONS_BY_REPO_FOLDER[base]) {
        return [...JUNCTIONS_BY_REPO_FOLDER[base]];
    }

    if (repoUrl) {
        const fromUrl = repoFolderKeyFromUrl(repoUrl);
        if (fromUrl && JUNCTIONS_BY_REPO_FOLDER[fromUrl]) {
            return [...JUNCTIONS_BY_REPO_FOLDER[fromUrl]];
        }
    }

    if (base.toLowerCase().includes('trapezedrtcoreui')) {
        return [...JUNCTIONS_CORE];
    }

    const jestConfigCandidates = [
        path.join(clonePath, 'source', 'jest.config.js'),
        path.join(clonePath, 'jest.config.js')
    ];
    const hasJest = jestConfigCandidates.some((p) => fs.existsSync(p));
    const gitignore = path.join(clonePath, '.gitignore');
    if (!hasJest || !fs.existsSync(gitignore)) {
        return [];
    }

    try {
        const ignoreText = fs.readFileSync(gitignore, 'utf8');
        if (!/we-common/i.test(ignoreText)) {
            return [];
        }
    } catch {
        return [];
    }

    return [...JUNCTIONS_STANDARD];
}

/**
 * Resolve junction profile from clone folder name and optional repo URL.
 * @param {string} clonePath
 * @param {string|null} [repoUrl]
 * @returns {'core'|'standard'|null}
 */
function getTrapezeJunctionProfile(clonePath, repoUrl = null) {
    const links = getConfiguredJunctionLinkNames(clonePath, repoUrl);
    if (links.length === 0) {
        return null;
    }
    return links.includes('we-track') ? JUNCTION_PROFILE_CORE : JUNCTION_PROFILE_STANDARD;
}

/**
 * Build authenticated clone URL (same rules as gitOperations.cloneAndTest).
 * @param {string} repoUrl
 * @param {{ username?: string, token?: string }|null} credentials
 * @returns {string}
 */
function buildAuthenticatedRepoUrl(repoUrl, credentials) {
    if (!credentials || !credentials.token) {
        return repoUrl;
    }
    try {
        const urlObj = new URL(repoUrl);
        urlObj.username = credentials.username || '';
        urlObj.password = credentials.token;
        return urlObj.toString();
    } catch {
        return repoUrl;
    }
}

/**
 * Derive sibling repo clone URL from Trapeze UI origin or fallback SSH pattern.
 * @param {string} originUrl - git remote origin URL
 * @param {string} siblingRepoName - e.g. TrapezeDRTCommonUI
 * @returns {string}
 */
function deriveSiblingRepoUrl(originUrl, siblingRepoName) {
    if (!originUrl || typeof originUrl !== 'string') {
        return `${DEFAULT_GITEA_SSH_BASE}/${siblingRepoName}.git`;
    }

    const trimmed = originUrl.trim();

    // SSH: host:org/TrapezeDRTYouBookUI.git -> host:org/Sibling.git
    const sshMatch = trimmed.match(/^([^:]+:[^/]+\/)([^/]+?)(\.git)?$/i);
    if (sshMatch) {
        return `${sshMatch[1]}${siblingRepoName}.git`;
    }

    try {
        const urlObj = new URL(trimmed);
        const parts = urlObj.pathname.split('/').filter(Boolean);
        if (parts.length > 0) {
            parts[parts.length - 1] = `${siblingRepoName}.git`;
            urlObj.pathname = `/${parts.join('/')}`;
            return urlObj.toString();
        }
    } catch {
        // not a URL
    }

    const repoFileMatch = trimmed.match(/([^/]+?)(\.git)?$/i);
    if (repoFileMatch && repoFileMatch[1] !== siblingRepoName) {
        return trimmed.replace(repoFileMatch[1], siblingRepoName);
    }

    if (trimmed.includes(CORE_UI_REPO_BASENAME)) {
        return trimmed.replace(CORE_UI_REPO_BASENAME, siblingRepoName);
    }

    return `${DEFAULT_GITEA_SSH_BASE}/${siblingRepoName}.git`;
}

/**
 * Read origin remote URL from a cloned repo.
 * @param {string} clonePath
 * @param {function} runGitCommand
 * @returns {Promise<string|null>}
 */
async function readOriginUrl(clonePath, runGitCommand) {
    const result = await runGitCommand(['remote', 'get-url', 'origin'], clonePath);
    if (result.success && result.stdout) {
        return result.stdout.trim();
    }
    return null;
}

/**
 * True when this clone should receive Trapeze UI junction links.
 * @param {string} clonePath
 * @param {string|null} [repoUrl]
 * @returns {boolean}
 */
function isTrapezeUIClone(clonePath, repoUrl = null) {
    return getConfiguredJunctionLinkNames(clonePath, repoUrl).length > 0;
}

/**
 * True when this clone is Trapeze Core UI (junctions include we-track).
 * @param {string} clonePath
 * @param {string|null} [repoUrl]
 * @returns {boolean}
 */
function isTrapezeCoreUIClone(clonePath, repoUrl = null) {
    return getConfiguredJunctionLinkNames(clonePath, repoUrl).includes('we-track');
}

/**
 * Resolve app source dir under a Trapeze UI clone.
 * Prefers catalog sourceRoot (e.g. DriverCom source/UI/src, YouDrive `.`), then source/src, source/UI/src, or src.
 * @param {string} clonePath
 * @returns {string|null}
 */
function resolveTrapezeSrcDir(clonePath) {
    const folder = path.basename(clonePath);
    const catalogRel = SOURCE_ROOT_BY_REPO_FOLDER[folder];
    if (catalogRel) {
        const catalogPath =
            catalogRel === '.' ? path.resolve(clonePath) : path.join(clonePath, ...catalogRel.split('/'));
        if (fs.existsSync(catalogPath) && fs.statSync(catalogPath).isDirectory()) {
            return catalogPath;
        }
    }

    const candidates = [
        path.join(clonePath, 'source', 'src'),
        path.join(clonePath, 'source', 'UI', 'src'),
        path.join(clonePath, 'src')
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
            return candidate;
        }
    }
    return null;
}

/**
 * Canonical path for comparing junction targets on Windows.
 * @param {string} p
 * @returns {string}
 */
function canonicalPath(p) {
    try {
        return fs.realpathSync.native ? fs.realpathSync.native(p) : fs.realpathSync(p);
    } catch {
        return path.resolve(p);
    }
}

/**
 * Resolve existing junction/symlink target, if any.
 * @param {string} linkPath
 * @returns {string|null}
 */
function readLinkTarget(linkPath) {
    try {
        const stat = fs.lstatSync(linkPath);
        if (!stat.isSymbolicLink()) {
            return null;
        }
        return fs.readlinkSync(linkPath);
    } catch {
        return null;
    }
}

/**
 * True when linkPath already points at targetPath (junction or symlink).
 * @param {string} linkPath
 * @param {string} targetPath
 * @returns {boolean}
 */
function junctionPointsToTarget(linkPath, targetPath) {
    if (!fs.existsSync(linkPath)) {
        return false;
    }
    try {
        const linkCanon = canonicalPath(linkPath);
        const targetCanon = canonicalPath(targetPath);
        return linkCanon === targetCanon;
    } catch {
        const raw = readLinkTarget(linkPath);
        if (!raw) return false;
        const resolved = path.isAbsolute(raw) ? raw : path.resolve(path.dirname(linkPath), raw);
        return canonicalPath(resolved) === canonicalPath(targetPath);
    }
}

/**
 * Create a Windows directory junction (mklink /j semantics).
 * @param {string} linkPath - Junction path to create
 * @param {string} targetPath - Existing directory target
 * @returns {{ success: boolean, message: string }}
 */
function createJunction(linkPath, targetPath) {
    if (process.platform !== 'win32') {
        return { success: false, message: 'Junction setup is only supported on Windows' };
    }

    if (!fs.existsSync(targetPath)) {
        return { success: false, message: `Target directory does not exist: ${targetPath}` };
    }

    try {
        const targetStat = fs.statSync(targetPath);
        if (!targetStat.isDirectory()) {
            return { success: false, message: `Target is not a directory: ${targetPath}` };
        }
    } catch (err) {
        return { success: false, message: err.message };
    }

    if (fs.existsSync(linkPath)) {
        if (junctionPointsToTarget(linkPath, targetPath)) {
            return { success: true, message: 'Junction already exists' };
        }
        return {
            success: false,
            message: `Path already exists and is not the expected junction: ${linkPath}`
        };
    }

    try {
        fs.mkdirSync(path.dirname(linkPath), { recursive: true });
        fs.symlinkSync(targetPath, linkPath, 'junction');
        return { success: true, message: 'Junction created' };
    } catch (err) {
        return { success: false, message: err.message };
    }
}

/**
 * Build ordered branch candidates for a sibling repo (deduplicated).
 * @param {string} uiBranch - Active Trapeze UI branch
 * @param {string} repoName - Sibling repo folder name
 * @returns {string[]}
 */
function resolveSiblingBranchCandidates(uiBranch, repoName) {
    const ui = (uiBranch || 'develop').trim();
    const fixed = SIBLING_BRANCH_BY_REPO[repoName];
    const primary = fixed || ui;
    const ordered = [primary, ui, ...SIBLING_BRANCH_FALLBACKS];
    return [...new Set(ordered.filter(Boolean))];
}

/**
 * Resolve the preferred branch label for a sibling (first candidate).
 * @param {string} uiBranch
 * @param {string} repoName
 * @returns {string}
 */
function resolveSiblingBranch(uiBranch, repoName) {
    return resolveSiblingBranchCandidates(uiBranch, repoName)[0];
}

/**
 * Read current branch and short commit for a sibling repo.
 * @param {string} repoPath
 * @param {function} runGitCommand
 * @returns {Promise<{ branch: string|null, commit: string|null }>}
 */
async function readSiblingRepoGitState(repoPath, runGitCommand) {
    const branchResult = await runGitCommand(
        ['rev-parse', '--abbrev-ref', 'HEAD'],
        repoPath,
        30000,
        { repoName: path.basename(repoPath) }
    );
    const commitResult = await runGitCommand(
        ['rev-parse', '--short', 'HEAD'],
        repoPath,
        30000,
        { repoName: path.basename(repoPath) }
    );
    return {
        branch: branchResult.success ? (branchResult.stdout || '').trim() || null : null,
        commit: commitResult.success ? (commitResult.stdout || '').trim() || null : null
    };
}

/**
 * Try checkout + hard reset for one branch on a sibling repo.
 * @param {string} repoPath
 * @param {string} branch
 * @param {function} runGitCommand
 * @param {object} gitOpts
 * @returns {Promise<{ success: boolean, stderr?: string }>}
 */
async function tryCheckoutSiblingBranch(repoPath, branch, runGitCommand, gitOpts) {
    let checkoutResult = await runGitCommand(['checkout', '-f', branch], repoPath, 120000, gitOpts);
    if (!checkoutResult.success) {
        checkoutResult = await runGitCommand(
            ['checkout', '-b', branch, `origin/${branch}`],
            repoPath,
            120000,
            gitOpts
        );
        if (!checkoutResult.success && checkoutResult.stderr.includes('already exists')) {
            checkoutResult = await runGitCommand(['checkout', '-f', branch], repoPath, 120000, gitOpts);
        }
    }
    if (!checkoutResult.success) {
        return { success: false, stderr: checkoutResult.stderr };
    }

    const resetResult = await runGitCommand(
        ['reset', '--hard', `origin/${branch}`],
        repoPath,
        120000,
        gitOpts
    );
    if (!resetResult.success) {
        return { success: false, stderr: resetResult.stderr };
    }
    return { success: true };
}

/**
 * Clone sibling repo if missing, then checkout and reset using per-repo branch rules.
 * @param {string} parentDir
 * @param {string} repoName
 * @param {string} repoUrl
 * @param {string} uiBranch - Active UI branch (e.g. developV2)
 * @param {{ username?: string, token?: string }|null} credentials
 * @param {function} runGitCommand
 * @param {function} [onProgress]
 * @returns {Promise<{ success: boolean, message: string, repoPath: string, branch?: string|null, commit?: string|null, triedBranches?: string[] }>}
 */
async function ensureSiblingRepo(parentDir, repoName, repoUrl, uiBranch, credentials, runGitCommand, onProgress) {
    const repoPath = path.join(parentDir, repoName);
    const authUrl = buildAuthenticatedRepoUrl(repoUrl, credentials);
    const candidates = resolveSiblingBranchCandidates(uiBranch, repoName);
    const notify = (msg) => {
        if (onProgress) onProgress('linking_deps', msg, 58);
    };

    if (!fs.existsSync(repoPath)) {
        notify(`Cloning sibling ${repoName}...`);
        const cloneResult = await runGitCommand(['clone', authUrl, repoPath], parentDir, 300000, {
            repoName,
            credentials
        });
        if (!cloneResult.success) {
            let cleanError = cloneResult.stderr;
            if (credentials?.token) {
                cleanError = cleanError.replace(new RegExp(credentials.token, 'g'), '****');
            }
            return {
                success: false,
                message: `Clone ${repoName} failed: ${cleanError}`,
                repoPath,
                triedBranches: candidates
            };
        }
    }

    const gitOpts = { repoName, credentials };
    await runGitCommand(['fetch', 'origin'], repoPath, 120000, gitOpts);

    let checkedOutBranch = null;
    const errors = [];

    for (const branch of candidates) {
        notify(`Updating sibling ${repoName} (${branch})...`);
        const attempt = await tryCheckoutSiblingBranch(repoPath, branch, runGitCommand, gitOpts);
        if (attempt.success) {
            checkedOutBranch = branch;
            break;
        }
        errors.push(`${branch}: ${(attempt.stderr || '').trim()}`);
    }

    if (!checkedOutBranch) {
        return {
            success: false,
            message: `Checkout on ${repoName} failed (tried: ${candidates.join(', ')}). ${errors[errors.length - 1] || ''}`,
            repoPath,
            triedBranches: candidates
        };
    }

    const gitState = await readSiblingRepoGitState(repoPath, runGitCommand);
    return {
        success: true,
        message: `${repoName} on ${checkedOutBranch}`,
        repoPath,
        branch: gitState.branch || checkedOutBranch,
        commit: gitState.commit,
        triedBranches: candidates
    };
}

/**
 * Remove a Windows junction/symlink without deleting the target directory.
 * @param {string} linkPath
 * @returns {{ success: boolean, message: string }}
 */
function removeJunction(linkPath) {
    if (!fs.existsSync(linkPath)) {
        return { success: true, message: 'Link does not exist' };
    }
    try {
        const stat = fs.lstatSync(linkPath);
        if (stat.isSymbolicLink()) {
            fs.unlinkSync(linkPath);
            return { success: true, message: 'Junction removed' };
        }
        return { success: false, message: `Path is not a junction: ${linkPath}` };
    } catch (err) {
        return { success: false, message: err.message };
    }
}

/**
 * Set up Trapeze UI junctions under source/src or src (catalog-driven link names).
 * Clones missing sibling repos beside the UI clone when needed.
 *
 * @param {string} clonePath - Trapeze UI repository root
 * @param {object} options
 * @param {{ username?: string, token?: string }|null} [options.credentials]
 * @param {string} [options.branch='develop'] - Branch for sibling repos
 * @param {string} [options.repoUrl] - UI repo URL used to derive sibling URLs
 * @param {function} options.runGitCommand - git runner (from gitOperations)
 * @param {function} [options.onProgress] - (stage, message, percent) => void
 * @param {string} [options.logRepoName] - Display name for repo command log
 * @returns {Promise<{ success: boolean, skipped: boolean, message: string, profile: string|null, links: object[], warnings: string[] }>}
 */
async function setupTrapezeUIJunctions(clonePath, options = {}) {
    const {
        credentials = null,
        branch = 'develop',
        repoUrl = null,
        runGitCommand,
        onProgress,
        logRepoName: uiLogName = null
    } = options;

    const warnings = [];
    const links = [];
    const siblingBranches = [];

    const linkNames = getConfiguredJunctionLinkNames(clonePath, repoUrl);
    const profile = getTrapezeJunctionProfile(clonePath, repoUrl);

    if (linkNames.length === 0) {
        return {
            success: true,
            skipped: true,
            message: 'No junctions configured for this app',
            profile: null,
            links,
            warnings,
            siblingBranches
        };
    }

    if (process.platform !== 'win32') {
        return {
            success: true,
            skipped: true,
            message: 'Junction setup skipped (Windows only)',
            profile,
            links,
            warnings,
            siblingBranches
        };
    }

    if (typeof runGitCommand !== 'function') {
        return {
            success: false,
            skipped: false,
            message: 'runGitCommand is required',
            profile,
            links,
            warnings,
            siblingBranches
        };
    }

    const srcDir = resolveTrapezeSrcDir(clonePath);
    if (!srcDir) {
        return {
            success: false,
            skipped: false,
            message: 'source/src, source/UI/src, or src not found under Trapeze UI clone',
            profile,
            links,
            warnings,
            siblingBranches
        };
    }

    const parentDir = path.dirname(clonePath);
    const originUrl = repoUrl || (await readOriginUrl(clonePath, runGitCommand));
    const specs = getJunctionSpecsForLinks(linkNames);
    const linkLabels = specs.map((s) => s.linkName).join(', ');

    const uiLog = uiLogName || path.basename(clonePath);
    beginRepoLogSession(uiLog, {
        operation: 'setupTrapezeUIJunctions',
        profile,
        junctions: linkNames,
        branch,
        parentDir
    });

    if (onProgress) {
        onProgress('linking_deps', `Setting up ${linkLabels} links...`, 56);
    }

    for (const spec of specs) {
        const siblingUrl = deriveSiblingRepoUrl(originUrl, spec.repoName);
        const targetPath = path.join(parentDir, spec.repoName, ...spec.targetSubPath);
        const linkPath = path.join(srcDir, spec.linkName);
        const expectedBranch = resolveSiblingBranch(branch, spec.repoName);

        const repoResult = await ensureSiblingRepo(
            parentDir,
            spec.repoName,
            siblingUrl,
            branch,
            credentials,
            runGitCommand,
            onProgress
        );

        siblingBranches.push({
            repoName: spec.repoName,
            linkName: spec.linkName,
            expectedBranch,
            actualBranch: repoResult.branch || null,
            commit: repoResult.commit || null,
            success: repoResult.success
        });

        if (!repoResult.success) {
            warnings.push(repoResult.message);
            links.push({
                linkName: spec.linkName,
                success: false,
                message: repoResult.message,
                expectedBranch
            });
            continue;
        }

        if (repoResult.branch && repoResult.branch !== expectedBranch) {
            warnings.push(
                `${spec.repoName} is on ${repoResult.branch} (expected ${expectedBranch} for UI branch ${branch})`
            );
        }

        if (!fs.existsSync(targetPath)) {
            const msg = `Target missing after clone: ${targetPath}`;
            warnings.push(msg);
            links.push({ linkName: spec.linkName, success: false, message: msg, expectedBranch });
            continue;
        }

        // Re-point junction when it exists but targets the wrong directory
        if (fs.existsSync(linkPath) && !junctionPointsToTarget(linkPath, targetPath)) {
            const removed = removeJunction(linkPath);
            if (!removed.success) {
                warnings.push(`${spec.linkName}: ${removed.message}`);
                links.push({
                    linkName: spec.linkName,
                    success: false,
                    message: removed.message,
                    expectedBranch
                });
                continue;
            }
            warnings.push(
                `${spec.linkName} junction was re-pointed (was not targeting ${targetPath})`
            );
        }

        const junctionResult = createJunction(linkPath, targetPath);
        logRepoCommand({
            repoName: uiLog,
            commandType: 'junction',
            command: `mklink /j ${linkPath} ${targetPath}`,
            cwd: srcDir,
            success: junctionResult.success,
            exitCode: junctionResult.success ? 0 : 1,
            stdout: junctionResult.message,
            stderr: junctionResult.success ? '' : junctionResult.message
        });
        beginRepoLogSession(spec.repoName, {
            operation: 'siblingForJunction',
            linkName: spec.linkName,
            targetPath
        });
        logRepoCommand({
            repoName: spec.repoName,
            commandType: 'junction',
            command: `junction ${spec.linkName} -> ${targetPath}`,
            cwd: repoResult.repoPath,
            success: junctionResult.success,
            exitCode: junctionResult.success ? 0 : 1,
            stdout: junctionResult.message,
            stderr: junctionResult.success ? '' : junctionResult.message
        });

        links.push({
            linkName: spec.linkName,
            linkPath,
            targetPath,
            success: junctionResult.success,
            message: junctionResult.message,
            expectedBranch,
            actualBranch: repoResult.branch || null,
            commit: repoResult.commit || null
        });

        if (!junctionResult.success) {
            warnings.push(`${spec.linkName}: ${junctionResult.message}`);
        } else if (onProgress) {
            onProgress(
                'linking_deps',
                `Linked ${spec.linkName} → ${targetPath} (${repoResult.branch || expectedBranch})`,
                60
            );
        }
    }

    const allOk = links.length > 0 && links.every((l) => l.success);
    const anyOk = links.some((l) => l.success);
    const requiredLinks = specs.length;
    const failedRequired = links.filter((l) => !l.success).length;

    return {
        success: allOk || (anyOk && failedRequired === 0),
        skipped: false,
        message: allOk
            ? 'Trapeze junction links ready'
            : anyOk
              ? 'Trapeze junction links partially configured'
              : 'Trapeze junction setup failed',
        profile,
        links,
        warnings,
        siblingBranches,
        requiredLinks,
        failedLinks: failedRequired
    };
}

/** @deprecated Use setupTrapezeUIJunctions */
const setupTrapezeCoreUIJunctions = setupTrapezeUIJunctions;

module.exports = {
    JUNCTION_PROFILE_CORE,
    JUNCTION_PROFILE_STANDARD,
    TRAPEZE_JUNCTION_SPECS,
    TRAPEZE_JUNCTION_SPECS_STANDARD,
    JUNCTION_SPEC_BY_LINK_NAME,
    JUNCTIONS_BY_REPO_FOLDER,
    JUNCTION_PROFILE_BY_REPO_FOLDER,
    JUNCTION_SOURCE_REPO_FOLDERS,
    SIBLING_BRANCH_BY_REPO,
    SIBLING_BRANCH_FALLBACKS,
    getJunctionSpecsForLinks,
    getJunctionSpecsForProfile,
    getConfiguredJunctionLinkNames,
    getTrapezeJunctionProfile,
    getTrapezeSiblingRepos,
    buildAuthenticatedRepoUrl,
    deriveSiblingRepoUrl,
    resolveSiblingBranch,
    resolveSiblingBranchCandidates,
    readSiblingRepoGitState,
    isTrapezeUIClone,
    isTrapezeCoreUIClone,
    resolveTrapezeSrcDir,
    junctionPointsToTarget,
    createJunction,
    removeJunction,
    ensureSiblingRepo,
    setupTrapezeUIJunctions,
    setupTrapezeCoreUIJunctions
};
