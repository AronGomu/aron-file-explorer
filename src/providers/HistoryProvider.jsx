import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { readExplorerSession, LAST_LOCATION_KEY, readDirectoryScrollPositions, writeDirectoryScrollPositions } from '../utils/explorerSession';

// Create history context
const HistoryContext = createContext({
    history: [],
    currentIndex: -1,
    currentPath: null,
    canGoBack: false,
    canGoForward: false,
    navigateTo: () => {},
    goBack: () => {},
    goForward: () => {},
    getDirectoryViewState: () => null,
    saveDirectoryViewState: () => {},
});

export default function HistoryProvider({ children }) {
    // State for navigation history
    const [initialHistory] = useState(() => {
        const { tabs, activeTabId } = readExplorerSession();
        const activePath = tabs.find(tab => tab.id === activeTabId)?.path;
        if (activePath) return { history: [activePath], currentIndex: 0 };

        try {
            const lastPath = localStorage.getItem(LAST_LOCATION_KEY);
            if (lastPath) return { history: [lastPath], currentIndex: 0 };

            const saved = JSON.parse(sessionStorage.getItem('fileExplorerHistory') || '[]');
            const history = Array.isArray(saved)
                ? saved.filter(path => typeof path === 'string' && path.trim()) : [];
            const index = Number.parseInt(sessionStorage.getItem('fileExplorerHistoryIndex'), 10);
            return {
                history,
                currentIndex: history.length ? Math.max(0, Math.min(index || 0, history.length - 1)) : -1
            };
        } catch (error) {
            console.error('Failed to load navigation history:', error);
            return { history: [], currentIndex: -1 };
        }
    });
    const [history, setHistory] = useState(initialHistory.history);
    const [currentIndex, setCurrentIndex] = useState(initialHistory.currentIndex);
    const directoryViewStates = useRef(null);
    if (!directoryViewStates.current) directoryViewStates.current = readDirectoryScrollPositions();
    const getDirectoryViewState = useCallback(path => directoryViewStates.current.get(path), []);
    const saveDirectoryViewState = useCallback((path, state) => {
        if (!path) return;
        const previous = directoryViewStates.current.get(path);
        directoryViewStates.current.delete(path);
        directoryViewStates.current.set(path, state);
        if (!previous || previous.scrollTop !== state.scrollTop || previous.scrollLeft !== state.scrollLeft) {
            writeDirectoryScrollPositions(directoryViewStates.current);
        }
    }, []);

    // Derived state
    const currentPath = history[currentIndex] || null;
    const canGoBack = currentIndex > 0;
    const canGoForward = currentIndex < history.length - 1;

    // Save history to session storage when it changes
    useEffect(() => {
        if (history.length) {
            try {
                sessionStorage.setItem('fileExplorerHistory', JSON.stringify(history));
                sessionStorage.setItem('fileExplorerHistoryIndex', currentIndex.toString());
                if (currentPath) localStorage.setItem(LAST_LOCATION_KEY, currentPath);
            } catch (error) {
                console.error('Failed to save navigation history:', error);
            }
        }
    }, [history, currentIndex, currentPath]);

    // Navigate to a specific path
    const navigateTo = useCallback((path) => {
        if (path === currentPath) return;

        setHistory(prevHistory => {
            // If we're not at the end of the history, trim the forward history
            const newHistory = prevHistory.slice(0, currentIndex + 1);

            // Add the new path to history
            newHistory.push(path);

            // Set current index to the new end of history
            setCurrentIndex(newHistory.length - 1);

            return newHistory;
        });
    }, [currentIndex, currentPath]);

    // Navigate back in history
    const goBack = useCallback(() => {
        if (!canGoBack) return;
        setCurrentIndex(prevIndex => prevIndex - 1);
    }, [canGoBack]);

    // Navigate forward in history
    const goForward = useCallback(() => {
        if (!canGoForward) return;
        setCurrentIndex(prevIndex => prevIndex + 1);
    }, [canGoForward]);

    const contextValue = {
        history,
        currentIndex,
        currentPath,
        canGoBack,
        canGoForward,
        navigateTo,
        goBack,
        goForward,
        getDirectoryViewState,
        saveDirectoryViewState,
    };

    return (
        <HistoryContext.Provider value={contextValue}>
            {children}
        </HistoryContext.Provider>
    );
}

// Custom hook for using the history context
export const useHistory = () => useContext(HistoryContext);
