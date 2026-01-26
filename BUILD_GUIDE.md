# Build Guide - Voyagerr Lens

This guide explains how to package the Voyagerr Lens application into a standalone Windows executable.

## Prerequisites
- Node.js and npm installed.
- All dependencies installed (`npm install`).

## Build Process

### 1. Build the Application
To generate the standalone executable, run the following command in the project root:

```bash
npm run dist
```

This command will:
1. Run `webpack` to bundle the React frontend into the `dist/` folder.
2. Use `electron-builder` to package the application into a portable `.exe`.

### 2. Locate the Executable
Once the build is complete, you can find the executable in the following directory:

`d:\work\samWe\code-analyzer\dist_electron\`

The file will be named `Code Analyzer 1.0.0.exe` (or similar).

## Distribution
The generated `.exe` is **portable**. This means:
- You can move it to any folder on your computer.
- You can share it with others, and they can run it without installing Node.js or any other dependencies.
- It does not require an installer.

## Development Notes
- If you make changes to the code, you must run `npm run build` or `npm run dist` again to see those changes in the executable.
- For active development with hot-reloading (in the Electron window), use `npm start`.
