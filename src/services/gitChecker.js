const { execSync, spawn } = require('child_process');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Check if Git is installed on the system
 * @returns {{installed: boolean, version: string|null}}
 */
function checkGitInstalled() {
    try {
        const version = execSync('git --version', { encoding: 'utf8', timeout: 5000 }).trim();
        // Output is like "git version 2.42.0.windows.2"
        const match = version.match(/git version ([\d.]+)/);
        return {
            installed: true,
            version: match ? match[1] : version
        };
    } catch (error) {
        return {
            installed: false,
            version: null
        };
    }
}

/**
 * Get the Git for Windows installer URL
 * @returns {{url: string, filename: string}}
 */
function getGitInstallerInfo() {
    const arch = os.arch();
    const archSuffix = arch === 'x64' ? '64-bit' : '32-bit';
    // Use a known stable version
    const version = '2.43.0';
    return {
        url: `https://github.com/git-for-windows/git/releases/download/v${version}.windows.1/Git-${version}-${archSuffix}.exe`,
        filename: `Git-${version}-${archSuffix}.exe`,
        version
    };
}

/**
 * Download a file from URL, following redirects
 * @param {string} url
 * @param {string} destPath
 * @param {function} onProgress
 * @returns {Promise<void>}
 */
function downloadFile(url, destPath, onProgress) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : require('http');
        protocol.get(url, (response) => {
            // Handle redirects
            if (response.statusCode === 302 || response.statusCode === 301) {
                return downloadFile(response.headers.location, destPath, onProgress)
                    .then(resolve)
                    .catch(reject);
            }

            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
                return;
            }

            const file = fs.createWriteStream(destPath);
            const totalLength = parseInt(response.headers['content-length'], 10);
            let downloadedLength = 0;

            response.on('data', (chunk) => {
                downloadedLength += chunk.length;
                if (onProgress && totalLength) {
                    onProgress(Math.round((downloadedLength / totalLength) * 100));
                }
            });

            response.pipe(file);

            file.on('finish', () => {
                file.close();
                resolve();
            });

            file.on('error', (err) => {
                fs.unlinkSync(destPath);
                reject(err);
            });
        }).on('error', (err) => {
            reject(err);
        });
    });
}

/**
 * Install Git on Windows using the silent installer
 * @param {function} onProgress - Progress callback
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function installGit(onProgress) {
    if (os.platform() !== 'win32') {
        return {
            success: false,
            message: 'Automatic Git installation is only supported on Windows. Please install Git manually.'
        };
    }

    const installerInfo = getGitInstallerInfo();
    const tempDir = os.tmpdir();
    const installerPath = path.join(tempDir, installerInfo.filename);

    try {
        if (onProgress) onProgress({ stage: 'downloading', percent: 0 });

        await downloadFile(installerInfo.url, installerPath, (percent) => {
            if (onProgress) onProgress({ stage: 'downloading', percent });
        });

        if (onProgress) onProgress({ stage: 'installing', percent: 100 });

        // Run silent installer
        return new Promise((resolve) => {
            const installProcess = spawn(installerPath, ['/VERYSILENT', '/NORESTART'], {
                shell: true,
                stdio: 'pipe'
            });

            installProcess.on('close', (code) => {
                // Clean up installer
                try { fs.unlinkSync(installerPath); } catch (e) { /* ignore */ }

                if (code === 0) {
                    resolve({
                        success: true,
                        message: `Git ${installerInfo.version} installed successfully. Please restart the application.`
                    });
                } else {
                    resolve({
                        success: false,
                        message: `Installation failed with code ${code}. Try running the installer manually: ${installerPath}`
                    });
                }
            });

            installProcess.on('error', (err) => {
                resolve({
                    success: false,
                    message: `Failed to run installer: ${err.message}`
                });
            });
        });
    } catch (error) {
        return {
            success: false,
            message: `Installation failed: ${error.message}`
        };
    }
}

module.exports = {
    checkGitInstalled,
    installGit,
    getGitInstallerInfo
};
