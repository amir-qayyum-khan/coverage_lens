const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

// Use @babel/parser for JSX-aware AST parsing (available as transitive dep of @babel/core)
let babelParser = null;
try {
    babelParser = require('@babel/parser');
} catch (e) {
    // Fallback to acorn only
}

// File patterns to ignore
const IGNORE_FILE_PATTERNS = [
    /\.test\.js$/,
    /\.spec\.js$/,
    /\.test\.jsx$/,
    /\.spec\.jsx$/,
    /\.tests\.js$/,
    /\.tests\.jsx$/,
    /\.html$/,
    /i18n\//,
    /\.css$/,
    /\.scss$/,
    /\.less$/,
    /\.json$/,
    /\.md$/,
    /setupTests\.js$/,
    /webpack\..*js$/,
    /babel\.config\..*js$/,
    /\.babelrc$/,
    /jest\.config\..*js$/,
    /preStart\.js$/,
    /babel\.prod\.js$/,
    /babel\.dev\.js$/,
    /\.eslintrc\..*$/,
    /WeStore\.js$/,
    /version\.js$/,
    /store\.js$/,
    /postBuild\.js$/,
    /babelDev\.js$/,
    /babelProd\.js$/
];

// Folder names to ignore
const IGNORE_FOLDER_NAMES = ['i18n', '__tests__', '__test__', 'node_modules', '.git', 'dist', 'build', '__mocks__', 'config', 'public', 'assets', 'coverage', 'coverage-booking-folder', 'lcov-report'];

/**
 * Check if a file should be ignored based on patterns
 * @param {string} filePath - Path to the file
 * @returns {boolean} - True if file should be ignored
 */
function shouldIgnoreFile(filePath) {
    const fileName = path.basename(filePath);
    const normalizedPath = filePath.replace(/\\/g, '/');
    return IGNORE_FILE_PATTERNS.some(pattern => pattern.test(fileName) || pattern.test(normalizedPath));
}

/**
 * Check if a folder should be ignored
 * @param {string} folderName - Name of the folder
 * @returns {boolean} - True if folder should be ignored
 */
function shouldIgnoreFolder(folderName) {
    return IGNORE_FOLDER_NAMES.includes(folderName);
}

/**
 * Count the number of statements in JavaScript code using AST parsing
 * @param {string} code - JavaScript source code
 * @returns {number} - Number of statements
 */
function countStatements(code) {
    // Try @babel/parser first — it handles JSX, TypeScript decorators, etc.
    if (babelParser) {
        try {
            const ast = babelParser.parse(code, {
                sourceType: 'module',
                strictMode: false,
                allowImportExportEverywhere: true,
                allowAwaitOutsideFunction: true,
                allowReturnOutsideFunction: true,
                allowSuperOutsideMethod: true,
                plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator']
            });

            let statementCount = 0;

            function countNode(node) {
                if (!node) return;

                const statementTypes = [
                    'ExpressionStatement',
                    'BlockStatement',
                    'EmptyStatement',
                    'DebuggerStatement',
                    'WithStatement',
                    'ReturnStatement',
                    'LabeledStatement',
                    'BreakStatement',
                    'ContinueStatement',
                    'IfStatement',
                    'SwitchStatement',
                    'ThrowStatement',
                    'TryStatement',
                    'WhileStatement',
                    'DoWhileStatement',
                    'ForStatement',
                    'ForInStatement',
                    'ForOfStatement',
                    'VariableDeclaration',
                    'FunctionDeclaration',
                    'ClassDeclaration',
                    'ImportDeclaration',
                    'ExportNamedDeclaration',
                    'ExportDefaultDeclaration',
                    'ExportAllDeclaration'
                ];

                if (statementTypes.includes(node.type)) {
                    statementCount++;
                }

                for (const key in node) {
                    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range') {
                        continue;
                    }
                    const child = node[key];
                    if (Array.isArray(child)) {
                        child.forEach(c => {
                            if (c && typeof c === 'object' && c.type) {
                                countNode(c);
                            }
                        });
                    } else if (child && typeof child === 'object' && child.type) {
                        countNode(child);
                    }
                }
            }

            countNode(ast.program);
            return statementCount;
        } catch (babelErr) {
            // Babel parse failed — try plain acorn, then fallback
        }
    }

    // Acorn fallback (no JSX support)
    try {
        const ast = acorn.parse(code, {
            ecmaVersion: 'latest',
            sourceType: 'module',
            allowHashBang: true,
            allowAwaitOutsideFunction: true,
            allowImportExportEverywhere: true
        });

        let statementCount = 0;

        function countNode(node) {
            if (!node) return;

            // Count statement types
            const statementTypes = [
                'ExpressionStatement',
                'BlockStatement',
                'EmptyStatement',
                'DebuggerStatement',
                'WithStatement',
                'ReturnStatement',
                'LabeledStatement',
                'BreakStatement',
                'ContinueStatement',
                'IfStatement',
                'SwitchStatement',
                'ThrowStatement',
                'TryStatement',
                'WhileStatement',
                'DoWhileStatement',
                'ForStatement',
                'ForInStatement',
                'ForOfStatement',
                'VariableDeclaration',
                'FunctionDeclaration',
                'ClassDeclaration',
                'ImportDeclaration',
                'ExportNamedDeclaration',
                'ExportDefaultDeclaration',
                'ExportAllDeclaration'
            ];

            if (statementTypes.includes(node.type)) {
                statementCount++;
            }

            // Recursively process child nodes
            for (const key in node) {
                if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range') {
                    continue;
                }

                const child = node[key];
                if (Array.isArray(child)) {
                    child.forEach(c => {
                        if (c && typeof c === 'object' && c.type) {
                            countNode(c);
                        }
                    });
                } else if (child && typeof child === 'object' && child.type) {
                    countNode(child);
                }
            }
        }

        countNode(ast);
        return statementCount;
    } catch (error) {
        // If parsing fails, fall back to simple line counting
        return countStatementsFallback(code);
    }
}

/**
 * Fallback statement counting using regex patterns
 * @param {string} code - JavaScript source code
 * @returns {number} - Estimated number of statements
 */
function countStatementsFallback(code) {
    // Remove comments
    const noComments = code
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');

    // Count semicolons and common statement patterns
    const semicolons = (noComments.match(/;/g) || []).length;
    const braces = (noComments.match(/\{/g) || []).length;

    return semicolons + Math.floor(braces / 2);
}

/**
 * Analyze a single JavaScript file
 * @param {string} filePath - Absolute path to the file
 * @returns {object} - Analysis results
 */
function analyzeFile(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');

        // Count non-empty, non-comment lines
        let codeLines = 0;
        let inBlockComment = false;

        for (const line of lines) {
            const trimmed = line.trim();

            // Handle block comments
            if (inBlockComment) {
                if (trimmed.includes('*/')) {
                    inBlockComment = false;
                }
                continue;
            }

            if (trimmed.startsWith('/*')) {
                if (!trimmed.includes('*/')) {
                    inBlockComment = true;
                }
                continue;
            }

            // Skip empty lines and single-line comments
            if (trimmed === '' || trimmed.startsWith('//')) {
                continue;
            }

            codeLines++;
        }

        const statements = countStatements(content);

        return {
            filePath,
            fileName: path.basename(filePath),
            relativePath: filePath,
            totalLines: lines.length,
            codeLines,
            statements,
            success: true
        };
    } catch (error) {
        return {
            filePath,
            fileName: path.basename(filePath),
            relativePath: filePath,
            totalLines: 0,
            codeLines: 0,
            statements: 0,
            success: false,
            error: error.message
        };
    }
}

/**
 * Recursively get all JavaScript files in a folder
 * @param {string} folderPath - Path to the folder
 * @param {string} basePath - Base path for relative paths
 * @returns {string[]} - Array of file paths
 */
function getJsFiles(folderPath, basePath = folderPath) {
    const files = [];

    try {
        const entries = fs.readdirSync(folderPath, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(folderPath, entry.name);

            if (entry.isDirectory()) {
                if (!shouldIgnoreFolder(entry.name)) {
                    files.push(...getJsFiles(fullPath, basePath));
                }
            } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.jsx'))) {
                if (!shouldIgnoreFile(fullPath)) {
                    files.push(fullPath);
                }
            }
        }
    } catch (error) {
        console.error('Error reading directory:', error);
    }

    return files;
}

/**
 * Analyze all JavaScript files in a folder
 * @param {string} folderPath - Path to the folder to analyze
 * @returns {object} - Analysis results with file details and summary
 */
async function analyzeFolder(folderPath) {
    const { resolveAnalyzerTargetPath } = require('../utils/sourceRoot');
    const targetPath = resolveAnalyzerTargetPath(folderPath);

    const files = getJsFiles(targetPath);
    const results = [];

    let totalLines = 0;
    let totalCodeLines = 0;
    let totalStatements = 0;

    for (const filePath of files) {
        const analysis = analyzeFile(filePath);

        // Make path relative to the root folderPath for consistency in UI
        // Use forward slashes for cross-platform consistency in mapping
        analysis.relativePath = path.relative(folderPath, filePath).split(path.sep).join('/');

        results.push(analysis);

        if (analysis.success) {
            totalLines += analysis.totalLines;
            totalCodeLines += analysis.codeLines;
            totalStatements += analysis.statements;
        }
    }

    return {
        folderPath,
        files: results,
        summary: {
            totalFiles: results.length,
            totalLines,
            totalCodeLines,
            totalStatements,
            analyzedAt: new Date().toISOString()
        }
    };
}

module.exports = {
    analyzeFolder,
    analyzeFile,
    countStatements,
    shouldIgnoreFile,
    shouldIgnoreFolder,
    getJsFiles
};
