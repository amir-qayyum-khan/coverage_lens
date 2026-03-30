const { execSync, spawn } = require('child_process');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const TARGET_NODE_VERSION = '16.20.2';

/**
 * Check if Node.js is installed on the system
 * @returns {{installed: boolean, version: string|null, meetsMinimum: boolean}}
 */
function checkNodeInstalled() {
    try {
        const version = execSync('node --version', { encoding: 'utf8', timeout: 5000 }).trim();
        const versionNumber = version.replace('v', '');
        const [major] = versionNumber.split('.').map(Number);

        return {
            installed: true,
            version: versionNumber,
            meetsMinimum: major >= 16
        };
    } catch (error) {
        return {
            installed: false,
            version: null,
            meetsMinimum: false
        };
    }
}

/**
 * Check if npm packages are installed in a directory
 * @param {string} projectRoot - Path to the project root
 * @returns {{installed: boolean, message: string}}
 */
function checkPackagesInstalled(projectRoot) {
    const nodeModulesPath = path.join(projectRoot, 'node_modules');

    if (!fs.existsSync(nodeModulesPath)) {
        return {
            installed: false,
            message: `Dependencies not installed. Run "npm install" in: ${projectRoot}`
        };
    }

    // Check if Jest is available
    const jestPath = path.join(nodeModulesPath, '.bin', 'jest');
    const jestExists = fs.existsSync(jestPath) || fs.existsSync(jestPath + '.cmd');

    if (!jestExists) {
        return {
            installed: false,
            message: 'Jest is not installed. Run "npm install" to install dependencies.'
        };
    }

    return {
        installed: true,
        message: 'All dependencies are installed.'
    };
}

/**
 * Get the Node.js installer URL for the current platform
 * @returns {{url: string, filename: string, platform: string}}
 */
function getInstallerInfo() {
    const platform = os.platform();
    const arch = os.arch();

    if (platform === 'win32') {
        const archSuffix = arch === 'x64' ? 'x64' : 'x86';
        return {
            url: `https://nodejs.org/dist/v${TARGET_NODE_VERSION}/node-v${TARGET_NODE_VERSION}-${archSuffix}.msi`,
            filename: `node-v${TARGET_NODE_VERSION}-${archSuffix}.msi`,
            platform: 'windows'
        };
    } else if (platform === 'darwin') {
        return {
            url: `https://nodejs.org/dist/v${TARGET_NODE_VERSION}/node-v${TARGET_NODE_VERSION}.pkg`,
            filename: `node-v${TARGET_NODE_VERSION}.pkg`,
            platform: 'macos'
        };
    } else {
        // Linux - provide tar.gz for manual installation
        const archSuffix = arch === 'x64' ? 'x64' : 'armv7l';
        return {
            url: `https://nodejs.org/dist/v${TARGET_NODE_VERSION}/node-v${TARGET_NODE_VERSION}-linux-${archSuffix}.tar.xz`,
            filename: `node-v${TARGET_NODE_VERSION}-linux-${archSuffix}.tar.xz`,
            platform: 'linux'
        };
    }
}

/**
 * Download a file from URL to local path
 * @param {string} url - URL to download from
 * @param {string} destPath - Destination file path
 * @param {function} onProgress - Progress callback (percent)
 * @returns {Promise<void>}
 */
function downloadFile(url, destPath, onProgress) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath);

        https.get(url, (response) => {
            // Handle redirects
            if (response.statusCode === 302 || response.statusCode === 301) {
                file.close();
                fs.unlinkSync(destPath);
                return downloadFile(response.headers.location, destPath, onProgress)
                    .then(resolve)
                    .catch(reject);
            }

            if (response.statusCode !== 200) {
                file.close();
                fs.unlinkSync(destPath);
                reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
                return;
            }

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
            fs.unlinkSync(destPath);
            reject(err);
        });
    });
}

/**
 * Install Node.js on Windows using MSI installer
 * @param {string} installerPath - Path to the MSI installer
 * @returns {Promise<{success: boolean, message: string}>}
 */
function installNodeWindows(installerPath) {
    return new Promise((resolve) => {
        try {
            // Run MSI installer with elevated privileges
            const installProcess = spawn('msiexec', ['/i', installerPath, '/passive', '/norestart'], {
                shell: true,
                stdio: 'pipe'
            });

            installProcess.on('close', (code) => {
                if (code === 0) {
                    resolve({
                        success: true,
                        message: `Node.js ${TARGET_NODE_VERSION} installed successfully. Please restart the application.`
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
                    message: `Failed to run installer: ${err.message}. Try running manually with admin privileges: ${installerPath}`
                });
            });
        } catch (error) {
            resolve({
                success: false,
                message: `Installation error: ${error.message}`
            });
        }
    });
}

/**
 * Full installation process for Node.js
 * @param {function} onProgress - Progress callback
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function installNode(onProgress) {
    const installerInfo = getInstallerInfo();
    const tempDir = os.tmpdir();
    const installerPath = path.join(tempDir, installerInfo.filename);

    try {
        // Download installer
        if (onProgress) onProgress({ stage: 'downloading', percent: 0 });

        await downloadFile(installerInfo.url, installerPath, (percent) => {
            if (onProgress) onProgress({ stage: 'downloading', percent });
        });

        if (onProgress) onProgress({ stage: 'installing', percent: 100 });

        // Install based on platform
        if (installerInfo.platform === 'windows') {
            return await installNodeWindows(installerPath);
        } else {
            return {
                success: false,
                message: `Automatic installation not supported on ${installerInfo.platform}. ` +
                    `Please download and install manually from: https://nodejs.org/dist/v${TARGET_NODE_VERSION}/`
            };
        }
    } catch (error) {
        return {
            success: false,
            message: `Installation failed: ${error.message}`
        };
    }
}

/**
 * Install npm packages in a directory
 * @param {string} projectRoot - Path to the project root
 * @param {function} onProgress - Progress callback
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function installPackages(projectRoot, onProgress) {
    return new Promise((resolve) => {
        // gitOperations passes sendProgress(stage, message, percent) — not a single object
        if (onProgress) {
            onProgress('installing_deps', 'Installing dependencies (this may take a while)...', 75);
        }

        const npm = spawn('npm', ['install', '--legacy-peer-deps'], {
            cwd: projectRoot,
            shell: true
        });

        let stderr = '';

        npm.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        npm.on('close', (code) => {
            if (code === 0) {
                resolve({
                    success: true,
                    message: 'Dependencies installed successfully.'
                });
            } else {
                resolve({
                    success: false,
                    message: `npm install failed with code ${code}. ${stderr}`
                });
            }
        });

        npm.on('error', (err) => {
            resolve({
                success: false,
                message: `Failed to run npm install: ${err.message}`
            });
        });
    });
}

module.exports = {
    checkNodeInstalled,
    checkPackagesInstalled,
    installNode,
    installPackages,
    getInstallerInfo,
    TARGET_NODE_VERSION
};
