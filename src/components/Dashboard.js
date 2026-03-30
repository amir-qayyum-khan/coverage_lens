import React, { useState, useEffect, useCallback } from 'react';

const YOU_APPS = [
    { name: 'LaunchpadUI', url: 'https://git.we-support.se/Trapeze/TrapezeDRTPortalsLaunchpadUI.git' },
    { name: 'YouTravelUI', url: 'https://git.we-support.se/Trapeze/TrapezeDRTYouTravelUI.git' },
    { name: 'YouOperateUI', url: 'https://git.we-support.se/Trapeze/TrapezeDRTYouOperateUI.git' },
    { name: 'YouBookUI', url: 'https://git.we-support.se/Trapeze/TrapezeDRTYouBookUI.git' },
    { name: 'YouDriveUI', url: 'https://git.we-support.se/Trapeze/TrapezeDRTYouDriveUI.git' },
    { name: 'YouDriveAdminUI', url: 'https://git.we-support.se/Trapeze/TrapezeDRTYouDriveAdminUI.git' }
];

const WE_APPS = [
    { name: 'CoreUI', url: 'https://git.we-support.se/Trapeze/TrapezeDRTCoreUI.git' },
    { name: 'WeCertNEMT-UI', url: 'https://git.we-support.se/Trapeze/TrapezeDRTWeCertNEMT-UI.git' },
    { name: 'WeTrackUI', url: 'https://git.we-support.se/Trapeze/TrapezeDRTWeTrackUI.git' },
    { name: 'CertUI', url: 'https://git.we-support.se/Trapeze/TrapezeDRTCertUI.git' },
    { name: 'CommonUI', url: 'https://git.we-support.se/Trapeze/TrapezeDRTCommonUI.git' },
    { name: 'TravelmateWeUI', url: 'https://git.we-support.se/Trapeze/TrapezeDRTTravelmateWeUI.git' },
    { name: 'BatchSchedulingAgentUI', url: 'https://git.we-support.se/Trapeze/TrapezeDRTBatchSchedulingAgentUI.git' },
    { name: 'YouCertUI', url: 'https://git.we-support.se/Trapeze/TrapezeDRTYouCertUI.git' },
    { name: 'FrameworkUI', url: 'https://git.we-support.se/Trapeze/TrapezeFrameworkUI.git' }
];

function Dashboard({ onProjectReady }) {
    const [nodeStatus, setNodeStatus] = useState({ loading: true, installed: false, version: null });
    const [gitStatus, setGitStatus] = useState({ loading: true, installed: false, version: null });
    const [installingNode, setInstallingNode] = useState(false);
    const [installingGit, setInstallingGit] = useState(false);
    const [installProgress, setInstallProgress] = useState(null);
    const [appStatuses, setAppStatuses] = useState({});
    const [branchInputs, setBranchInputs] = useState({});
    const [error, setError] = useState(null);

    // Git Credentials State
    const [showSettings, setShowSettings] = useState(false);
    const [gitCredentials, setGitCredentials] = useState(() => {
        const saved = localStorage.getItem('git_credentials');
        return saved ? JSON.parse(saved) : { username: '', token: '' };
    });

    const checkEnvironments = useCallback(async () => {
        try {
            const nodeResponse = await window.electronAPI.checkNode();
            if (nodeResponse.success) {
                setNodeStatus({ loading: false, ...nodeResponse.data });
            }

            const gitResponse = await window.electronAPI.checkGit();
            if (gitResponse.success) {
                setGitStatus({ loading: false, ...gitResponse.data });
            }
        } catch (err) {
            setError('Failed to check environment: ' + err.message);
        }
    }, []);

    useEffect(() => {
        checkEnvironments();

        const removeNodeProgress = window.electronAPI.onNodeInstallProgress((progress) => {
            setInstallProgress(progress);
        });

        const removeGitProgress = window.electronAPI.onGitInstallProgress((progress) => {
            setInstallProgress(progress);
        });

        const removeAppProgress = window.electronAPI.onAppProgress((progress) => {
            setAppStatuses(prev => ({
                ...prev,
                [progress.repoName]: {
                    ...prev[progress.repoName],
                    stage: progress.stage,
                    message: progress.message,
                    percent: progress.percent,
                    status: 'loading'
                }
            }));
        });

        return () => {
            removeNodeProgress();
            removeGitProgress();
            removeAppProgress();
        };
    }, [checkEnvironments]);

    const handleInstallNode = async () => {
        setInstallingNode(true);
        try {
            const result = await window.electronAPI.installNode();
            if (result.success) {
                await checkEnvironments();
            } else {
                setError(result.message);
            }
        } catch (err) {
            setError('Node installation failed: ' + err.message);
        } finally {
            setInstallingNode(false);
            setInstallProgress(null);
        }
    };

    const handleInstallGit = async () => {
        setInstallingGit(true);
        try {
            const result = await window.electronAPI.installGit();
            if (result.success) {
                await checkEnvironments();
            } else {
                setError(result.message);
            }
        } catch (err) {
            setError('Git installation failed: ' + err.message);
        } finally {
            setInstallingGit(false);
            setInstallProgress(null);
        }
    };

    const handleCloneAndTest = async (app) => {
        // Find or Choose a base directory for clones? 
        // For now, let's assume we clone into a "repos" folder in the current workspace or similar
        // Let's ask the user to select a folder first if we don't have one?
        // Actually, the easiest is to just use the code-analyzer directory's parent or a specific subfolder.
        // User didn't specify, so I'll show a folder selection dialog for the base path if not set.

        try {
            const baseDir = await window.electronAPI.selectFolder();
            if (!baseDir) return;

            setAppStatuses(prev => ({
                ...prev,
                [app.name]: { status: 'loading', stage: 'starting', message: 'Initiating...', percent: 0 }
            }));

            const result = await window.electronAPI.cloneAndTest(app.url, baseDir, gitCredentials, branchInputs[app.name]);

            setAppStatuses(prev => ({
                ...prev,
                [app.name]: {
                    status: result.success ? 'success' : 'error',
                    message: result.data?.message || result.message,
                    branch: result.data?.branch,
                    testResults: result.data?.testResults,
                    percent: 100
                }
            }));

            // Automatically switch to analysis view if integration callback exists
            if (result.success && onProjectReady && result.data?.clonePath) {
                onProjectReady(result.data.clonePath);
            }

        } catch (err) {
            setAppStatuses(prev => ({
                ...prev,
                [app.name]: { status: 'error', message: err.message, percent: 100 }
            }));
        }
    };

    const handleSaveCredentials = () => {
        localStorage.setItem('git_credentials', JSON.stringify(gitCredentials));
        setShowSettings(false);
    };

    const renderStatusBadge = (status) => {
        if (status.loading) return <span className="badge badge-loading">Checking...</span>;
        if (status.installed) return <span className="badge badge-success">✓ v{status.version}</span>;
        return <span className="badge badge-error">✗ Not Found</span>;
    };

    const renderAppList = (title, apps) => (
        <div className="app-section">
            <h3 className="section-title">{title}</h3>
            <div className="app-grid">
                {apps.map(app => {
                    const status = appStatuses[app.name];
                    return (
                        <div key={app.name} className={`app-card ${status?.status || ''}`}>
                            <div className="app-card-header">
                                <div className="app-icon">{app.name.charAt(0)}</div>
                                <div className="app-info">
                                    <h4 className="app-name">{app.name}</h4>
                                    <div className="app-url">{app.url}</div>
                                </div>
                            </div>

                            {status && (
                                <div className="app-status">
                                    {status.status === 'loading' && (
                                        <div className="progress-container">
                                            <div className="progress-label">
                                                <span>{String(status.stage ?? '')}: {String(status.message ?? '')}</span>
                                                <span>{status.percent}%</span>
                                            </div>
                                            <div className="progress-bar">
                                                <div className="progress-bar-fill" style={{ width: `${status.percent}%` }}></div>
                                            </div>
                                        </div>
                                    )}
                                    {status.status === 'success' && (
                                        <div className="test-results">
                                            <div className="res-item">Branch: <strong>{status.branch}</strong></div>
                                            {status.testResults && (
                                                <div className="res-item">
                                                    Tests: <span className={status.testResults.failedTests > 0 ? 'text-error' : 'text-success'}>
                                                        {status.testResults.passedTests}/{status.testResults.totalTests} Passed
                                                    </span>
                                                </div>
                                            )}
                                            <div className="res-msg">{String(status.message ?? '')}</div>
                                        </div>
                                    )}
                                    {status.status === 'error' && (
                                        <div className="error-message-container">
                                            <div className="text-error">{status.message || 'An unknown error occurred'}</div>
                                            {String(status.message ?? '').toLowerCase().includes('auth') && (
                                                <button
                                                    className="btn btn-secondary btn-xs"
                                                    style={{ marginTop: '5px' }}
                                                    onClick={() => setShowSettings(true)}
                                                >
                                                    Configure Auth
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}

                            <div className="app-card-actions" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                <div className="form-group" style={{ width: '100%' }}>
                                    <input
                                        type="text"
                                        className="styled-input"
                                        placeholder="Branch (default: master)"
                                        value={branchInputs[app.name] || ''}
                                        onChange={(e) => {
                                            // Read value before setState: React 16 pools events; functional updaters run later when e.target is null
                                            const value = e.target.value;
                                            setBranchInputs((prev) => ({ ...prev, [app.name]: value }));
                                        }}
                                        style={{ 
                                            width: '100%', 
                                            padding: '6px 10px', 
                                            fontSize: '12px',
                                            background: 'rgba(255,255,255,0.05)',
                                            border: '1px solid rgba(255,255,255,0.1)',
                                            borderRadius: 'var(--radius-sm)',
                                            color: 'white'
                                        }}
                                    />
                                </div>
                                <button
                                    className="btn btn-primary btn-sm"
                                    onClick={() => handleCloneAndTest(app)}
                                    disabled={status?.status === 'loading' || !nodeStatus.installed || !gitStatus.installed}
                                    style={{ width: '100%' }}
                                >
                                    {status?.status === 'loading' ? 'Processing...' : 'Clone & Test'}
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );

    return (
        <div className="dashboard fade-in">
            <header className="dashboard-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h2 className="section-title" style={{ marginBottom: 0 }}>Environment Dashboard</h2>
                <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setShowSettings(!showSettings)}
                >
                    <span style={{ marginRight: '5px' }}>⚙️</span> Git Settings
                </button>
            </header>

            {showSettings && (
                <div className="settings-panel fade-in" style={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-lg)',
                    padding: 'var(--spacing-lg)',
                    marginBottom: 'var(--spacing-xl)',
                    position: 'relative'
                }}>
                    <div className="settings-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-md)' }}>
                        <h3 style={{ margin: 0 }}>Git Credentials</h3>
                        <button className="close-btn" style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: '20px', cursor: 'pointer' }} onClick={() => setShowSettings(false)}>&times;</button>
                    </div>
                    <p className="settings-desc" style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: 'var(--spacing-md)' }}>
                        Provide your Git credentials to access private repositories. These are stored locally.
                    </p>
                    <div className="settings-form" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                        <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>Username (Optional)</label>
                            <input
                                type="text"
                                className="styled-input"
                                value={gitCredentials.username}
                                onChange={(e) => setGitCredentials({ ...gitCredentials, username: e.target.value })}
                                placeholder="Your username"
                                style={{ padding: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', color: 'white' }}
                            />
                        </div>
                        <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>Personal Access Token / Password</label>
                            <input
                                type="password"
                                className="styled-input"
                                value={gitCredentials.token}
                                onChange={(e) => setGitCredentials({ ...gitCredentials, token: e.target.value })}
                                placeholder="Enter token or password"
                                style={{ padding: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', color: 'white' }}
                            />
                        </div>
                        <button
                            className="btn btn-primary btn-sm"
                            style={{ alignSelf: 'flex-start' }}
                            onClick={handleSaveCredentials}
                        >
                            Save Credentials
                        </button>
                    </div>
                </div>
            )}

            {error && (
                <div className="error-banner">
                    <span className="error-icon">⚠️</span>
                    <span>{error}</span>
                    <button className="close-btn" onClick={() => setError(null)}>×</button>
                </div>
            )}

            <div className="env-section">
                <div className="env-card">
                    <div className="env-icon node-icon"></div>
                    <div className="env-info">
                        <h3>Node.js</h3>
                        <div className="env-status">
                            {renderStatusBadge(nodeStatus)}
                            {!nodeStatus.installed && !nodeStatus.loading && (
                                <button className="btn btn-secondary btn-xs" onClick={handleInstallNode} disabled={installingNode}>
                                    Install v16.20.2
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                <div className="env-card">
                    <div className="env-icon git-icon"></div>
                    <div className="env-info">
                        <h3>Git Client</h3>
                        <div className="env-status">
                            {renderStatusBadge(gitStatus)}
                            {!gitStatus.installed && !gitStatus.loading && (
                                <button className="btn btn-secondary btn-xs" onClick={handleInstallGit} disabled={installingGit}>
                                    Install Git
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {(installingNode || installingGit) && installProgress && (
                <div className="install-progress-overlay">
                    <div className="install-box">
                        <h3>Installing {installingNode ? 'Node.js' : 'Git'}...</h3>
                        <p>{installProgress.stage}: {installProgress.percent}%</p>
                        <div className="progress-bar">
                            <div className="progress-bar-fill" style={{ width: `${installProgress.percent}%` }}></div>
                        </div>
                    </div>
                </div>
            )}

            {renderAppList('You Apps', YOU_APPS)}
            {renderAppList('We Apps', WE_APPS)}
        </div>
    );
}

export default Dashboard;
