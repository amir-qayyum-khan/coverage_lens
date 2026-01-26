import React from 'react';

/**
 * FolderBrowser component for selecting and displaying folder path
 * @param {Object} props
 * @param {string} props.folderPath - Current folder path
 * @param {Function} props.onFolderPathChange - Handler for path input change
 * @param {Function} props.onBrowse - Handler for browse button click
 * @param {Function} props.onAnalyze - Handler for analyze button click
 * @param {boolean} props.isLoading - Whether analysis is in progress
 */
function FolderBrowser({
    folderPath,
    onFolderPathChange,
    onBrowse,
    onAnalyze,
    isLoading
}) {
    const handleInputChange = (e) => {
        onFolderPathChange(e.target.value);
    };

    const handleKeyPress = (e) => {
        if (e.key === 'Enter' && folderPath && !isLoading) {
            onAnalyze();
        }
    };

    return (
        <div className="folder-browser fade-in">
            <div className="folder-browser-row">
                <button
                    className="btn btn-secondary"
                    onClick={onBrowse}
                    disabled={isLoading}
                    aria-label="Browse for folder"
                >
                    <span className="btn-icon">📁</span>
                    Browse
                </button>

                <input
                    type="text"
                    className="folder-path-input"
                    value={folderPath}
                    onChange={handleInputChange}
                    onKeyPress={handleKeyPress}
                    placeholder="Select or enter folder path..."
                    disabled={isLoading}
                    aria-label="Folder path"
                />

                <button
                    className="btn btn-primary"
                    onClick={onAnalyze}
                    disabled={!folderPath || isLoading}
                    aria-label={isLoading ? 'Analyzing folder' : 'Analyze folder'}
                >
                    <span className="btn-icon">🔍</span>
                    {isLoading ? 'Analyzing...' : 'Analyze'}
                </button>
            </div>
        </div>
    );
}

export default FolderBrowser;
