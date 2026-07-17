const {
    YOU_APPS,
    WE_APPS,
    JUNCTIONS_STANDARD,
    JUNCTIONS_CORE,
    repoFolderKeyFromUrl,
    normalizeAppJunctions,
    normalizeAppSourceRoot,
    buildJunctionsByRepoFolder,
    buildSourceRootByRepoFolder
} = require('./appsCatalog');

describe('appsCatalog', () => {
    test('repoFolderKeyFromUrl strips .git and returns basename', () => {
        expect(
            repoFolderKeyFromUrl('https://git.we-support.se/Trapeze/TrapezeDRTYouBookUI.git')
        ).toBe('TrapezeDRTYouBookUI');
        expect(repoFolderKeyFromUrl('')).toBe('');
    });

    test('normalizeAppJunctions keeps known unique link names', () => {
        expect(normalizeAppJunctions(['we-common', 'we-framework', 'we-common', 'nope'])).toEqual([
            'we-common',
            'we-framework'
        ]);
        expect(normalizeAppJunctions(null)).toEqual([]);
    });

    test('normalizeAppSourceRoot normalizes and rejects unsafe paths', () => {
        expect(normalizeAppSourceRoot('source/UI/src')).toBe('source/UI/src');
        expect(normalizeAppSourceRoot('  source\\UI\\src  ')).toBe('source/UI/src');
        expect(normalizeAppSourceRoot('../etc')).toBeNull();
        expect(normalizeAppSourceRoot('C:/abs')).toBeNull();
        expect(normalizeAppSourceRoot('')).toBeNull();
        expect(normalizeAppSourceRoot(null)).toBeNull();
    });

    test('selected apps declare expected junctions', () => {
        const byName = Object.fromEntries(
            [...YOU_APPS, ...WE_APPS].map((a) => [a.name, normalizeAppJunctions(a.junctions)])
        );

        expect(byName.YouOperateUI).toEqual(JUNCTIONS_STANDARD);
        expect(byName.YouBookUI).toEqual(JUNCTIONS_STANDARD);
        expect(byName.YouApplyUI).toEqual(JUNCTIONS_STANDARD);
        expect(byName.CoreUI).toEqual(JUNCTIONS_CORE);
        expect(byName['WeCertNEMT-UI']).toEqual(JUNCTIONS_STANDARD);
        expect(byName.CertUI).toEqual(JUNCTIONS_STANDARD);
        expect(byName.TravelmateWeUI).toEqual(JUNCTIONS_STANDARD);
        expect(byName.BatchSchedulingAgentUI).toEqual(JUNCTIONS_STANDARD);
        expect(byName.DriverCom).toEqual(JUNCTIONS_STANDARD);

        expect(byName.LaunchpadUI).toEqual([]);
        expect(byName.WeTrackUI).toEqual([]);
        expect(byName.CommonUI).toEqual([]);
        expect(byName.FrameworkUI).toEqual([]);
    });

    test('DriverCom declares nested sourceRoot', () => {
        const driverCom = WE_APPS.find((a) => a.name === 'DriverCom');
        expect(driverCom).toBeDefined();
        expect(normalizeAppSourceRoot(driverCom.sourceRoot)).toBe('source/UI/src');
    });

    test('buildJunctionsByRepoFolder maps URL basenames for apps with junctions', () => {
        const map = buildJunctionsByRepoFolder();
        expect(map.TrapezeDRTYouBookUI).toEqual(JUNCTIONS_STANDARD);
        expect(map.TrapezeDRTYouApply).toEqual(JUNCTIONS_STANDARD);
        expect(map.TrapezeDRTDriverCom).toEqual(JUNCTIONS_STANDARD);
        expect(map.TrapezeDRTCoreUI).toEqual(JUNCTIONS_CORE);
        expect(map.TrapezeDRTCommonUI).toBeUndefined();
        expect(map.TrapezeDRTWeTrackUI).toBeUndefined();
    });

    test('buildSourceRootByRepoFolder maps DriverCom override only', () => {
        const map = buildSourceRootByRepoFolder();
        expect(map.TrapezeDRTDriverCom).toBe('source/UI/src');
        expect(map.TrapezeDRTYouApply).toBeUndefined();
        expect(map.TrapezeDRTCoreUI).toBeUndefined();
    });

    test('YOU_APPS and WE_APPS URL basenames are unique across catalogs', () => {
        const keys = [...YOU_APPS, ...WE_APPS].map((a) => repoFolderKeyFromUrl(a.url));
        expect(new Set(keys).size).toBe(keys.length);
    });
});
