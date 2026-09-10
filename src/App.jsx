import React from 'react';
import SettingsProvider from './providers/SettingsProvider';
import ThemeProvider from './providers/ThemeProvider';
import AppStateProvider from './providers/AppStateProvider';
import HistoryProvider from './providers/HistoryProvider';
import SftpProvider from './providers/SftpProvider';
import FileSystemProvider from './providers/FileSystemProvider';
import ContextMenuProvider from './providers/ContextMenuProvider';
import MainLayout from './layouts/MainLayout';

// Simple fallback for error cases
function ErrorFallback() {
    return (
        <div style={{
            padding: '20px',
            color: 'var(--text-primary)',
            backgroundColor: 'var(--background)',
            fontFamily: 'system-ui, sans-serif',
            maxWidth: '800px',
            margin: '40px auto',
            border: '1px solid var(--border-strong)',
            borderRadius: '8px',
            boxShadow: '0 2px 8px var(--shadow)'
        }}>
            <h1 style={{ color: 'var(--text-primary)' }}>Fast File Explorer</h1>
            <p>The application could not be loaded properly. Try refreshing the page.</p>
            <p>If the problem persists, check the console (F12) for error messages.</p>
            <button
                onClick={() => window.location.reload()}
                style={{
                    padding: '8px 16px',
                    backgroundColor: 'var(--accent)',
                    color: 'var(--text-on-accent)',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    marginTop: '15px'
                }}
            >
                Reload Page
            </button>
        </div>
    );
}

// App component with error boundary
class App extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false };
    }

    // Error Boundary
    static getDerivedStateFromError(error) {
        return { hasError: true };
    }

    componentDidCatch(error, errorInfo) {
        console.error("Application error:", error, errorInfo);
    }

    render() {
        // Show fallback in case of error
        if (this.state.hasError) {
            return <ErrorFallback />;
        }

        // Render normal application with all providers
        // IMPORTANT: Provider order matters for proper initialization:
        // 1. SettingsProvider should be first as other providers may depend on settings
        // 2. ThemeProvider depends on settings and should come second
        // 3. AppStateProvider provides general app state
        // 4. HistoryProvider should come before FileSystemProvider since navigation depends on history
        // 5. SftpProvider should come before FileSystemProvider to provide SFTP operations
        // 6. FileSystemProvider provides file system operations
        // 7. ContextMenuProvider should come after FileSystemProvider to access selected items
        return (
            <div className="app-container">
                <SettingsProvider>
                    <ThemeProvider>
                        <AppStateProvider>
                            <HistoryProvider>
                                <SftpProvider>
                                    <FileSystemProvider>
                                        <ContextMenuProvider>
                                            <MainLayout />
                                        </ContextMenuProvider>
                                    </FileSystemProvider>
                                </SftpProvider>
                            </HistoryProvider>
                        </AppStateProvider>
                    </ThemeProvider>
                </SettingsProvider>
            </div>
        );
    }
}

export default App;