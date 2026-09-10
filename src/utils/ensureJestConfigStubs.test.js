const fs = require('fs');
const os = require('os');
const path = require('path');
const { ensureGitignoredConfigStubs } = require('./ensureJestConfigStubs');

describe('ensureGitignoredConfigStubs', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jest-config-stubs-'));
    });

    afterEach(() => {
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
            // ignore
        }
    });

    test('writes config.js and theme.js when config/index.js exists and stubs are missing', () => {
        const configDir = path.join(tmpDir, 'config');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
            path.join(configDir, 'index.js'),
            "import * as config from './config.js'\nexport default config\n",
            'utf8'
        );

        const result = ensureGitignoredConfigStubs(tmpDir);

        expect(result.wroteConfigJs).toBe(true);
        expect(result.wroteThemeJs).toBe(true);
        expect(fs.existsSync(path.join(configDir, 'config.js'))).toBe(true);
        expect(fs.existsSync(path.join(configDir, 'theme.js'))).toBe(true);
        expect(fs.readFileSync(path.join(configDir, 'config.js'), 'utf8')).toMatch(/Voyagerr Lens/);
    });

    test('does not overwrite existing config.js or theme.js', () => {
        const configDir = path.join(tmpDir, 'config');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(path.join(configDir, 'index.js'), "export default {}\n", 'utf8');
        fs.writeFileSync(path.join(configDir, 'config.js'), 'export const real = true;\n', 'utf8');
        fs.writeFileSync(path.join(configDir, 'theme.js'), 'export const getTheme = () => ({});\n', 'utf8');

        const result = ensureGitignoredConfigStubs(tmpDir);

        expect(result.wroteConfigJs).toBe(false);
        expect(result.wroteThemeJs).toBe(false);
        expect(fs.readFileSync(path.join(configDir, 'config.js'), 'utf8')).toBe('export const real = true;\n');
        expect(fs.readFileSync(path.join(configDir, 'theme.js'), 'utf8')).toBe(
            'export const getTheme = () => ({});\n'
        );
    });

    test('no-ops when config/index.js is absent', () => {
        const result = ensureGitignoredConfigStubs(tmpDir);
        expect(result.wroteConfigJs).toBe(false);
        expect(result.wroteThemeJs).toBe(false);
        expect(fs.existsSync(path.join(tmpDir, 'config'))).toBe(false);
    });
});
