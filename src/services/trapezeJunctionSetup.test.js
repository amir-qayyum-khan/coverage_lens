const fs = require('fs');
const os = require('os');
const path = require('path');
const { YOU_APPS, WE_APPS, repoFolderKeyFromUrl, normalizeAppJunctions } = require('../data/appsCatalog');

const {
    JUNCTION_PROFILE_BY_REPO_FOLDER,
    JUNCTIONS_BY_REPO_FOLDER,
    JUNCTION_PROFILE_CORE,
    JUNCTION_PROFILE_STANDARD,
    SIBLING_BRANCH_BY_REPO,
    getJunctionSpecsForProfile,
    getJunctionSpecsForLinks,
    getConfiguredJunctionLinkNames,
    getTrapezeSiblingRepos,
    getTrapezeJunctionProfile,
    deriveSiblingRepoUrl,
    resolveSiblingBranch,
    resolveSiblingBranchCandidates,
    isTrapezeUIClone,
    isTrapezeCoreUIClone,
    resolveTrapezeSrcDir,
    junctionPointsToTarget,
    createJunction,
    removeJunction,
    setupTrapezeUIJunctions,
    setupTrapezeCoreUIJunctions
} = require('./trapezeJunctionSetup');

describe('trapezeJunctionSetup', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trapeze-junction-'));
    });

    afterEach(() => {
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
            // ignore
        }
    });

    test('getTrapezeSiblingRepos returns three official CoreUI links', () => {
        const repos = getTrapezeSiblingRepos();
        expect(repos).toHaveLength(3);
        expect(repos.map((r) => r.linkName)).toEqual(['we-common', 'we-framework', 'we-track']);
    });

    test('getJunctionSpecsForProfile standard returns two links', () => {
        const repos = getJunctionSpecsForProfile(JUNCTION_PROFILE_STANDARD);
        expect(repos).toHaveLength(2);
        expect(repos.map((r) => r.linkName)).toEqual(['we-common', 'we-framework']);
    });

    describe('catalog junctions', () => {
        test('maps configured catalog apps to core or standard profiles', () => {
            expect(JUNCTION_PROFILE_BY_REPO_FOLDER.TrapezeDRTCoreUI).toBe(JUNCTION_PROFILE_CORE);
            expect(JUNCTION_PROFILE_BY_REPO_FOLDER.TrapezeDRTYouBookUI).toBe(JUNCTION_PROFILE_STANDARD);
            expect(JUNCTION_PROFILE_BY_REPO_FOLDER.TrapezeDRTBatchSchedulingAgentUI).toBe(
                JUNCTION_PROFILE_STANDARD
            );
            expect(JUNCTION_PROFILE_BY_REPO_FOLDER.TrapezeDRTPortalsLaunchpadUI).toBeUndefined();
            expect(JUNCTION_PROFILE_BY_REPO_FOLDER.TrapezeDRTCommonUI).toBeUndefined();
            expect(JUNCTION_PROFILE_BY_REPO_FOLDER.TrapezeFrameworkUI).toBeUndefined();
            expect(JUNCTION_PROFILE_BY_REPO_FOLDER.TrapezeDRTWeTrackUI).toBeUndefined();
        });

        test('JUNCTIONS_BY_REPO_FOLDER matches catalog junctions arrays', () => {
            for (const app of [...YOU_APPS, ...WE_APPS]) {
                const folder = repoFolderKeyFromUrl(app.url);
                const expected = normalizeAppJunctions(app.junctions);
                if (expected.length === 0) {
                    expect(JUNCTIONS_BY_REPO_FOLDER[folder]).toBeUndefined();
                } else {
                    expect(JUNCTIONS_BY_REPO_FOLDER[folder]).toEqual(expected);
                    expect(getConfiguredJunctionLinkNames(path.join(tmpDir, folder))).toEqual(
                        expected
                    );
                }
            }
        });

        test('getJunctionSpecsForLinks resolves registry entries', () => {
            const specs = getJunctionSpecsForLinks(['we-common', 'we-track', 'nope']);
            expect(specs.map((s) => s.linkName)).toEqual(['we-common', 'we-track']);
        });
    });

    describe('resolveSiblingBranch', () => {
        test('CommonUI follows UI branch developV2', () => {
            expect(resolveSiblingBranch('developV2', 'TrapezeDRTCommonUI')).toBe('developV2');
        });

        test('Framework uses develop when UI is developV2', () => {
            expect(resolveSiblingBranch('developV2', 'TrapezeFrameworkUI')).toBe('develop');
            expect(SIBLING_BRANCH_BY_REPO.TrapezeFrameworkUI).toBe('develop');
        });

        test('WeTrack uses develop-we when UI is developV2', () => {
            expect(resolveSiblingBranch('developV2', 'TrapezeDRTWeTrackUI')).toBe('develop-we');
        });

        test('candidates are deduplicated and ordered', () => {
            const candidates = resolveSiblingBranchCandidates('developV2', 'TrapezeDRTWeTrackUI');
            expect(candidates[0]).toBe('develop-we');
            expect(candidates).toContain('developV2');
            expect(new Set(candidates).size).toBe(candidates.length);
        });
    });

    describe('deriveSiblingRepoUrl', () => {
        test('derives HTTPS sibling URL from Core UI origin', () => {
            const url = deriveSiblingRepoUrl(
                'https://git.we-support.se/Trapeze/TrapezeDRTCoreUI.git',
                'TrapezeDRTCommonUI'
            );
            expect(url).toBe('https://git.we-support.se/Trapeze/TrapezeDRTCommonUI.git');
        });

        test('derives HTTPS sibling URL from YouBook UI origin', () => {
            const url = deriveSiblingRepoUrl(
                'https://git.we-support.se/Trapeze/TrapezeDRTYouBookUI.git',
                'TrapezeDRTCommonUI'
            );
            expect(url).toBe('https://git.we-support.se/Trapeze/TrapezeDRTCommonUI.git');
        });

        test('derives SSH sibling URL from Core UI origin', () => {
            const url = deriveSiblingRepoUrl(
                'gitea@git.we-support.se:Trapeze/TrapezeDRTCoreUI.git',
                'TrapezeFrameworkUI'
            );
            expect(url).toBe('gitea@git.we-support.se:Trapeze/TrapezeFrameworkUI.git');
        });

        test('falls back to default SSH base when origin missing', () => {
            const url = deriveSiblingRepoUrl(null, 'TrapezeDRTWeTrackUI');
            expect(url).toContain('TrapezeDRTWeTrackUI.git');
        });
    });

    describe('getTrapezeJunctionProfile', () => {
        test('returns core for CoreUI folder name', () => {
            const clonePath = path.join(tmpDir, 'TrapezeDRTCoreUI');
            fs.mkdirSync(clonePath, { recursive: true });
            expect(getTrapezeJunctionProfile(clonePath)).toBe(JUNCTION_PROFILE_CORE);
        });

        test('returns standard for catalog YouBook UI folder', () => {
            const clonePath = path.join(tmpDir, 'TrapezeDRTYouBookUI');
            fs.mkdirSync(clonePath, { recursive: true });
            expect(getTrapezeJunctionProfile(clonePath)).toBe(JUNCTION_PROFILE_STANDARD);
        });

        test('returns standard from repo URL when folder name differs', () => {
            const clonePath = path.join(tmpDir, 'custom-checkout');
            fs.mkdirSync(clonePath, { recursive: true });
            expect(
                getTrapezeJunctionProfile(
                    clonePath,
                    'https://git.we-support.se/Trapeze/TrapezeDRTYouOperateUI.git'
                )
            ).toBe(JUNCTION_PROFILE_STANDARD);
        });

        test('detects standard by jest config and gitignore we-common', () => {
            const clonePath = path.join(tmpDir, 'MyApp');
            fs.mkdirSync(path.join(clonePath, 'source'), { recursive: true });
            fs.writeFileSync(path.join(clonePath, 'source', 'jest.config.js'), 'module.exports = {};');
            fs.writeFileSync(path.join(clonePath, '.gitignore'), 'source/we-common/*\n');
            expect(getTrapezeJunctionProfile(clonePath)).toBe(JUNCTION_PROFILE_STANDARD);
        });

        test('returns null for unrelated repos', () => {
            const clonePath = path.join(tmpDir, 'OtherApp');
            fs.mkdirSync(clonePath, { recursive: true });
            expect(getTrapezeJunctionProfile(clonePath)).toBeNull();
        });
    });

    describe('isTrapezeUIClone / isTrapezeCoreUIClone', () => {
        test('isTrapezeUIClone true for catalog and heuristic clones', () => {
            const corePath = path.join(tmpDir, 'TrapezeDRTCoreUI');
            fs.mkdirSync(corePath, { recursive: true });
            expect(isTrapezeUIClone(corePath)).toBe(true);
            expect(isTrapezeCoreUIClone(corePath)).toBe(true);

            const bookPath = path.join(tmpDir, 'TrapezeDRTYouBookUI');
            fs.mkdirSync(bookPath, { recursive: true });
            expect(isTrapezeUIClone(bookPath)).toBe(true);
            expect(isTrapezeCoreUIClone(bookPath)).toBe(false);
        });

        test('returns false for unrelated repos', () => {
            const clonePath = path.join(tmpDir, 'OtherApp');
            fs.mkdirSync(clonePath, { recursive: true });
            expect(isTrapezeUIClone(clonePath)).toBe(false);
            expect(isTrapezeCoreUIClone(clonePath)).toBe(false);
        });
    });

    describe('resolveTrapezeSrcDir', () => {
        test('prefers source/src when present', () => {
            const clonePath = path.join(tmpDir, 'TrapezeDRTCoreUI');
            const nested = path.join(clonePath, 'source', 'src');
            const rootSrc = path.join(clonePath, 'src');
            fs.mkdirSync(nested, { recursive: true });
            fs.mkdirSync(rootSrc, { recursive: true });
            expect(resolveTrapezeSrcDir(clonePath)).toBe(nested);
        });

        test('falls back to root src when source/src missing', () => {
            const clonePath = path.join(tmpDir, 'TrapezeDRTYouBookUI');
            const rootSrc = path.join(clonePath, 'src');
            fs.mkdirSync(rootSrc, { recursive: true });
            expect(resolveTrapezeSrcDir(clonePath)).toBe(rootSrc);
        });

        test('uses catalog sourceRoot for DriverCom (source/UI/src)', () => {
            const clonePath = path.join(tmpDir, 'TrapezeDRTDriverCom');
            const uiSrc = path.join(clonePath, 'source', 'UI', 'src');
            const backend = path.join(clonePath, 'source', 'Backend');
            fs.mkdirSync(uiSrc, { recursive: true });
            fs.mkdirSync(backend, { recursive: true });
            expect(resolveTrapezeSrcDir(clonePath)).toBe(uiSrc);
        });

        test('falls back to source/UI/src when catalog folder name differs', () => {
            const clonePath = path.join(tmpDir, 'SomeOtherClone');
            const uiSrc = path.join(clonePath, 'source', 'UI', 'src');
            fs.mkdirSync(uiSrc, { recursive: true });
            expect(resolveTrapezeSrcDir(clonePath)).toBe(uiSrc);
        });
    });

    describe('createJunction', () => {
        test('skips on non-Windows platforms', () => {
            const original = process.platform;
            Object.defineProperty(process, 'platform', { value: 'linux' });
            const result = createJunction('/tmp/link', '/tmp/target');
            Object.defineProperty(process, 'platform', { value: original });
            expect(result.success).toBe(false);
            expect(result.message).toMatch(/only supported on Windows/i);
        });

        test('creates junction on Windows when target exists', () => {
            if (process.platform !== 'win32') {
                return;
            }

            const target = path.join(tmpDir, 'target-dir');
            const link = path.join(tmpDir, 'src', 'we-common');
            fs.mkdirSync(target, { recursive: true });
            fs.mkdirSync(path.dirname(link), { recursive: true });

            const result = createJunction(link, target);
            expect(result.success).toBe(true);
            expect(fs.existsSync(link)).toBe(true);
            expect(junctionPointsToTarget(link, target)).toBe(true);

            const second = createJunction(link, target);
            expect(second.success).toBe(true);
            expect(second.message).toMatch(/already exists/i);
        });
    });

    describe('setupTrapezeUIJunctions', () => {
        test('skips when catalog has no junctions for the app', async () => {
            const clonePath = path.join(tmpDir, 'TrapezeDRTPortalsLaunchpadUI');
            fs.mkdirSync(path.join(clonePath, 'src'), { recursive: true });

            const runGitCommand = jest.fn();
            const result = await setupTrapezeUIJunctions(clonePath, { runGitCommand });

            expect(result.skipped).toBe(true);
            expect(result.success).toBe(true);
            expect(result.message).toMatch(/no junctions configured/i);
            expect(result.profile).toBeNull();
            expect(result.links).toHaveLength(0);
            expect(runGitCommand).not.toHaveBeenCalled();
        });

        test('skips non-Trapeze clones', async () => {
            const clonePath = path.join(tmpDir, 'OtherRepo');
            fs.mkdirSync(clonePath, { recursive: true });

            const result = await setupTrapezeUIJunctions(clonePath, {
                runGitCommand: jest.fn()
            });

            expect(result.skipped).toBe(true);
            expect(result.success).toBe(true);
            expect(result.profile).toBeNull();
            expect(result.message).toMatch(/no junctions configured/i);
        });

        test('creates three junctions for CoreUI when sibling targets exist', async () => {
            if (process.platform !== 'win32') {
                return;
            }

            const parent = tmpDir;
            const clonePath = path.join(parent, 'TrapezeDRTCoreUI');
            fs.mkdirSync(path.join(clonePath, 'source', 'src'), { recursive: true });
            fs.writeFileSync(path.join(clonePath, '.gitignore'), 'source/we-common/*\n');

            for (const spec of getTrapezeSiblingRepos()) {
                const target = path.join(parent, spec.repoName, ...spec.targetSubPath);
                fs.mkdirSync(target, { recursive: true });
            }

            const runGitCommand = jest.fn().mockImplementation((args) => {
                if (args[0] === 'rev-parse') {
                    const branch =
                        args[1] === '--abbrev-ref'
                            ? 'develop-we'
                            : 'abc1234';
                    return Promise.resolve({ success: true, stdout: `${branch}\n`, stderr: '' });
                }
                return Promise.resolve({ success: true, stdout: '', stderr: '' });
            });

            const result = await setupTrapezeUIJunctions(clonePath, {
                branch: 'developV2',
                repoUrl: 'gitea@git.we-support.se:Trapeze/TrapezeDRTCoreUI.git',
                runGitCommand,
            });

            expect(result.skipped).toBe(false);
            expect(result.profile).toBe(JUNCTION_PROFILE_CORE);
            expect(result.links).toHaveLength(3);
            expect(result.links.every((l) => l.success)).toBe(true);
            expect(result.siblingBranches).toHaveLength(3);

            const frameworkCheckout = runGitCommand.mock.calls.find(
                (c) => c[0][1] === '-f' && c[0][2] === 'develop'
            );
            expect(frameworkCheckout).toBeDefined();

            const weTrackCheckout = runGitCommand.mock.calls.find(
                (c) => c[0][1] === '-f' && c[0][2] === 'develop-we'
            );
            expect(weTrackCheckout).toBeDefined();

            for (const spec of getTrapezeSiblingRepos()) {
                const link = path.join(clonePath, 'source', 'src', spec.linkName);
                expect(fs.existsSync(link)).toBe(true);
            }
        });

        test('checks out develop for Framework when UI is developV2 (no developV2 on Framework)', async () => {
            const parent = tmpDir;
            const clonePath = path.join(parent, 'TrapezeDRTCoreUI');
            fs.mkdirSync(path.join(clonePath, 'source', 'src'), { recursive: true });

            const frameworkTarget = path.join(parent, 'TrapezeFrameworkUI', 'source', 'src');
            fs.mkdirSync(frameworkTarget, { recursive: true });

            const attempts = [];
            const runGitCommand = jest.fn().mockImplementation((args, cwd) => {
                if (args[0] === 'checkout' && args[1] === '-f') {
                    attempts.push({ branch: args[2], cwd: path.basename(cwd) });
                }
                if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') {
                    return Promise.resolve({ success: true, stdout: 'develop\n', stderr: '' });
                }
                if (args[0] === 'rev-parse' && args[1] === '--short') {
                    return Promise.resolve({ success: true, stdout: '29619c5\n', stderr: '' });
                }
                return Promise.resolve({ success: true, stdout: '', stderr: '' });
            });

            const result = await setupTrapezeUIJunctions(clonePath, {
                branch: 'developV2',
                runGitCommand,
            });

            const frameworkSibling = result.siblingBranches.find(
                (s) => s.repoName === 'TrapezeFrameworkUI'
            );
            expect(frameworkSibling).toBeDefined();
            expect(frameworkSibling.expectedBranch).toBe('develop');
            expect(attempts.some((a) => a.branch === 'develop' && a.cwd === 'TrapezeFrameworkUI')).toBe(
                true
            );
            expect(attempts.some((a) => a.branch === 'developV2' && a.cwd === 'TrapezeFrameworkUI')).toBe(
                false
            );
        });

        test('warns and re-points junction when link targets wrong directory', async () => {
            if (process.platform !== 'win32') {
                return;
            }

            const parent = tmpDir;
            const clonePath = path.join(parent, 'TrapezeDRTCoreUI');
            const srcDir = path.join(clonePath, 'source', 'src');
            fs.mkdirSync(srcDir, { recursive: true });

            const commonTarget = path.join(parent, 'TrapezeDRTCommonUI', 'source', 'src');
            const wrongTarget = path.join(parent, 'wrong-common');
            fs.mkdirSync(commonTarget, { recursive: true });
            fs.mkdirSync(wrongTarget, { recursive: true });

            const linkPath = path.join(srcDir, 'we-common');
            createJunction(linkPath, wrongTarget);

            const runGitCommand = jest.fn().mockImplementation((args) => {
                if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') {
                    return Promise.resolve({ success: true, stdout: 'developV2\n', stderr: '' });
                }
                if (args[0] === 'rev-parse' && args[1] === '--short') {
                    return Promise.resolve({ success: true, stdout: '7fba6e28\n', stderr: '' });
                }
                return Promise.resolve({ success: true, stdout: '', stderr: '' });
            });

            const result = await setupTrapezeUIJunctions(clonePath, {
                branch: 'developV2',
                runGitCommand,
            });

            expect(result.warnings.some((w) => /re-pointed/i.test(w))).toBe(true);
            expect(junctionPointsToTarget(linkPath, commonTarget)).toBe(true);
        });

        test('creates two junctions for YouBook UI under root src when sibling targets exist', async () => {
            if (process.platform !== 'win32') {
                return;
            }

            const parent = tmpDir;
            const clonePath = path.join(parent, 'TrapezeDRTYouBookUI');
            fs.mkdirSync(path.join(clonePath, 'src'), { recursive: true });

            for (const spec of getJunctionSpecsForProfile(JUNCTION_PROFILE_STANDARD)) {
                const target = path.join(parent, spec.repoName, ...spec.targetSubPath);
                fs.mkdirSync(target, { recursive: true });
            }

            const runGitCommand = jest.fn().mockResolvedValue({ success: true, stdout: '', stderr: '' });

            const result = await setupTrapezeUIJunctions(clonePath, {
                branch: 'develop',
                repoUrl: 'gitea@git.we-support.se:Trapeze/TrapezeDRTYouBookUI.git',
                runGitCommand
            });

            expect(result.skipped).toBe(false);
            expect(result.profile).toBe(JUNCTION_PROFILE_STANDARD);
            expect(result.links).toHaveLength(2);
            expect(result.links.every((l) => l.success)).toBe(true);
            expect(fs.existsSync(path.join(clonePath, 'src', 'we-common'))).toBe(true);
            expect(fs.existsSync(path.join(clonePath, 'src', 'we-framework'))).toBe(true);
            expect(fs.existsSync(path.join(clonePath, 'src', 'we-track'))).toBe(false);
        });

        test('setupTrapezeCoreUIJunctions is an alias', async () => {
            const clonePath = path.join(tmpDir, 'OtherRepo');
            fs.mkdirSync(clonePath, { recursive: true });
            expect(setupTrapezeCoreUIJunctions).toBe(setupTrapezeUIJunctions);
        });

        test('warns and continues when sibling clone fails', async () => {
            if (process.platform !== 'win32') {
                return;
            }

            const clonePath = path.join(tmpDir, 'TrapezeDRTCoreUI');
            fs.mkdirSync(path.join(clonePath, 'source', 'src'), { recursive: true });
            fs.writeFileSync(path.join(clonePath, '.gitignore'), 'we-common\n');

            const runGitCommand = jest.fn().mockResolvedValue({
                success: false,
                stdout: '',
                stderr: 'auth failed'
            });

            const result = await setupTrapezeUIJunctions(clonePath, {
                branch: 'develop',
                runGitCommand,
            });

            expect(result.warnings.length).toBeGreaterThan(0);
            expect(result.links.some((l) => !l.success)).toBe(true);
        });
    });
});
