import React, { createContext, useContext, useState, useCallback } from 'react';
import usePersistedState from '../hooks/usePersistedState';

// Create context
const AppStateContext = createContext({
    isSearching: false,
    isTemplateViewOpen: false,
    isSidebarCollapsed: false,
    currentView: 'explorer', // 'explorer', 'this-pc', 'search-results', 'template-view'
    setIsSearching: () => {},
    toggleTemplateView: () => {},
    toggleSidebar: () => {},
    setIsSidebarCollapsed: () => {},
    setCurrentView: () => {},
});

// Provider component
export default function AppStateProvider({ children }) {
    const [isSearching, setIsSearching] = useState(false);
    const [isTemplateViewOpen, setIsTemplateViewOpen] = useState(false);
    const [isSidebarCollapsed, setIsSidebarCollapsed] = usePersistedState('fileExplorerSidebarCollapsed', false);
    const [currentView, setCurrentView] = useState('explorer');

    // Toggle template view
    const toggleTemplateView = useCallback(() => {
        setIsTemplateViewOpen(prev => !prev);

        if (!isTemplateViewOpen) {
            setCurrentView('template-view');
        } else {
            setCurrentView('explorer');
        }
    }, [isTemplateViewOpen]);

    // Toggle sidebar
    const toggleSidebar = useCallback(() => {
        setIsSidebarCollapsed(prev => !prev);
    }, []);

    const contextValue = {
        isSearching,
        isTemplateViewOpen,
        isSidebarCollapsed,
        currentView,
        setIsSearching,
        toggleTemplateView,
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
