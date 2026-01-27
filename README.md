# Voyagerr Lens

A desktop application for analyzing JavaScript code metrics and test coverage using Jest.

![Electron](https://img.shields.io/badge/Electron-25.0.0-47848F?logo=electron)
![React](https://img.shields.io/badge/React-16.13.1-61DAFB?logo=react)
![Jest](https://img.shields.io/badge/Jest-27.5.1-C21325?logo=jest)

## Features

- 📊 **Code Analysis** - Analyze lines of code and statement counts
- 🧪 **Test Coverage** - Run Jest tests and collect coverage metrics
- 📁 **Folder Selection** - Choose any folder to analyze
- 📈 **Visual Statistics** - View results in a modern, dark-themed UI
- 📤 **Excel Export** - Export analysis results to Excel files
- ⏱️ **Execution Timer** - See how long analysis takes

---

## Project Structure

```
code-analyzer/
├── main.js                    # Electron main process
├── preload.js                 # Electron preload script (IPC bridge)
├── package.json               # Project dependencies and scripts
├── webpack.config.js          # Webpack configuration
├── jest.config.js             # Jest test configuration
├── babel.config.js            # Babel configuration
│
├── src/                       # Source code
│   ├── index.js               # React entry point
│   ├── index.html             # HTML template
│   ├── index.css              # Global styles
│   ├── App.js                 # Main React component
│   ├── App.test.js            # App component tests
│   │
│   ├── components/            # React components
│   │   ├── FolderBrowser.js   # Folder selection UI
│   │   ├── Summary.js         # Statistics summary cards
│   │   ├── ResultsGrid.js     # File results table
│   │   ├── AnalysisLoader.js  # Loading animation
│   │   └── *.test.js          # Component tests
│   │
│   ├── services/              # Backend services
│   │   ├── codeAnalyzer.js    # Static code analysis (LOC, statements)
│   │   ├── coverageRunner.js  # Jest coverage execution
│   │   └── nodeInstaller.js   # Node.js installation helper
│   │
│   └── assets/                # Static assets (logo, images)
│
├── dist/                      # Webpack build output
└── dist_electron/             # Electron Builder output (EXE files)
```

---

## How It Works

### 1. Folder Selection
User selects a folder containing JavaScript files via the UI.

### 2. Code Analysis
The `codeAnalyzer.js` service:
- Scans all `.js` files (excluding tests, i18n, etc.)
- Uses [Acorn](https://github.com/acornjs/acorn) to parse AST
- Counts lines of code and statements

### 3. Coverage Collection
The `coverageRunner.js` service:
- Finds the nearest `package.json` (project root)
- Runs Jest with `--coverage` and `--findRelatedTests`
- Parses coverage JSON reports
- Returns line/statement coverage percentages

### 4. Results Display
Results are merged and displayed in:
- Summary cards (total lines, coverage %)
- Detailed file-by-file table
- Execution time banner

---

## Getting Started

### Prerequisites
- Node.js 16.x or higher
- npm

### Installation

```bash
# Clone the repository
git clone https://github.com/amir-qayyum-khan/coverage_lese.git
cd code-analyzer

# Install dependencies
npm install
```

### Development

```bash
# Build and run in development mode
npm run dev

# Or run build and start separately
npm run build
npm start
```

### Running Tests

```bash
# Run all tests
npm test

# Run tests with coverage
npm test -- --coverage

# Watch mode
npm run test:watch
```

---

## Creating an Executable (EXE)

### Quick Build

```bash
npm run dist
```

This will:
1. Build the React app with Webpack
2. Package with Electron Builder
3. Output a portable `.exe` to `dist_electron/`

### Build Output

After running `npm run dist`, find your executable at:
```
dist_electron/Voyagerr Lens 1.0.0.exe
```

### Build Configuration

The build is configured in `package.json`:

```json
{
  "build": {
    "appId": "com.samwe.voyagerrlens",
    "productName": "Voyagerr Lens",
    "directories": {
      "output": "dist_electron"
    },
    "win": {
      "target": "portable"
    }
  }
}
```

### Build Options

| Target | Description |
|--------|-------------|
| `portable` | Single `.exe` file (default) |
| `nsis` | Windows installer |
| `msi` | MSI installer |

To change the target, modify `build.win.target` in `package.json`.

---

## Scripts Reference

| Script | Description |
|--------|-------------|
| `npm start` | Build and run Electron app |
| `npm run dev` | Development mode with DevTools |
| `npm run build` | Build React app with Webpack |
| `npm run watch` | Watch mode for development |
| `npm test` | Run Jest tests |
| `npm run dist` | Create distributable EXE |

---

## License

ISC
