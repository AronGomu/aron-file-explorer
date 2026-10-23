import React, { createContext, useContext, useState, useCallback } from 'react';
import usePersistedState from '../hooks/usePersistedState';

// Create context
const AppStateContext = createContext({
    isSearching: false,
    isSidebarCollapsed: false,
    currentView: 'explorer', // 'explorer', 'this-pc', 'search-results'
    setIsSearching: () => {},
    toggleSidebar: () => {},
    setIsSidebarCollapsed: () => {},
    setCurrentView: () => {},
});

// Provider component
export default function AppStateProvider({ children }) {
    const [isSearching, setIsSearching] = useState(false);
    const [isSidebarCollapsed, setIsSidebarCollapsed] = usePersistedState('fileExplorerSidebarCollapsed', false);
    const [currentView, setCurrentView] = useState('explorer');

    // Toggle sidebar
    const toggleSidebar = useCallback(() => {
        setIsSidebarCollapsed(prev => !prev);
    }, []);

    const contextValue = {
        isSearching,
        isSidebarCollapsed,
        currentView,
        setIsSearching,
        toggleSidebar,
        setIsSidebarCollapsed,
        setCurrentView,
    };

    return (
        <AppStateContext.Provider value={contextValue}>
            {children}
        </AppStateContext.Provider>
    );
}

// Custom hook for using the app state context
export const useAppState = () => useContext(AppStateContext);
