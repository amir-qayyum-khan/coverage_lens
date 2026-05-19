const fs = require('fs');
const os = require('os');
const path = require('path');
const { isFileUnderFolder, toDisplayRelativePath } = require('./coveragePaths');

describe('coveragePaths', () => {
    let tmpDir;
    let folderDir;
    let projectRoot;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-paths-'));
        projectRoot = path.join(tmpDir, 'project');
        folderDir = path.join(projectRoot, 'src', 'booking');
        fs.mkdirSync(folderDir, { recursive: true });
        fs.writeFileSync(path.join(folderDir, 'widget.js'), 'export default 1;\n', 'utf8');
        fs.writeFileSync(path.join(projectRoot, 'src', 'other.js'), 'export default 2;\n', 'utf8');
    });

    afterEach(() => {
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
            // ignore
        }
    });

    test('isFileUnderFolder accepts file inside folder (absolute path)', () => {
        const filePath = path.join(folderDir, 'widget.js');
        expect(isFileUnderFolder(folderDir, filePath, projectRoot)).toBe(true);
    });

    test('isFileUnderFolder rejects file outside folder', () => {
        const filePath = path.join(projectRoot, 'src', 'other.js');
        expect(isFileUnderFolder(folderDir, filePath, projectRoot)).toBe(false);
    });

    test('isFileUnderFolder accepts project-relative keys', () => {
        expect(isFileUnderFolder(folderDir, 'src/booking/widget.js', projectRoot)).toBe(true);
        expect(isFileUnderFolder(folderDir, 'src/other.js', projectRoot)).toBe(false);
    });

    test('toDisplayRelativePath returns forward-slash relative path', () => {
        const filePath = path.join(folderDir, 'widget.js');
        expect(toDisplayRelativePath(folderDir, filePath, projectRoot)).toBe('widget.js');
    });
});
