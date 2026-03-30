const fs = require('fs');
const os = require('os');
const path = require('path');
const { listImmediateChildDirectories } = require('./superDashboardParentScan');

describe('superDashboardParentScan', () => {
    let tmpRoot;

    beforeEach(() => {
        tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'super-dash-parent-'));
    });

    afterEach(() => {
        try {
            fs.rmSync(tmpRoot, { recursive: true, force: true });
        } catch {
            // ignore
        }
    });

    test('returns sorted child directory paths', () => {
        fs.mkdirSync(path.join(tmpRoot, 'zeta'));
        fs.mkdirSync(path.join(tmpRoot, 'alpha'));
        fs.writeFileSync(path.join(tmpRoot, 'file.txt'), 'x');
        const got = listImmediateChildDirectories(tmpRoot);
        expect(got).toEqual([
            path.join(tmpRoot, 'alpha'),
            path.join(tmpRoot, 'zeta')
        ]);
    });

    test('skips hidden directories', () => {
        fs.mkdirSync(path.join(tmpRoot, '.hidden'));
        fs.mkdirSync(path.join(tmpRoot, 'visible'));
        const got = listImmediateChildDirectories(tmpRoot);
        expect(got).toEqual([path.join(tmpRoot, 'visible')]);
    });

    test('returns empty for missing path', () => {
        expect(listImmediateChildDirectories(path.join(tmpRoot, 'nope'))).toEqual([]);
    });

    test('returns empty for invalid input', () => {
        expect(listImmediateChildDirectories('')).toEqual([]);
        expect(listImmediateChildDirectories('   ')).toEqual([]);
        expect(listImmediateChildDirectories(null)).toEqual([]);
    });
});
