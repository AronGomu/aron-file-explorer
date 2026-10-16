export const EXPLORER_SESSION_KEY = 'fileExplorerSession';
export const LAST_LOCATION_KEY = 'fileExplorerLastLocation';

export const readExplorerSession = () => {
    try {
        const saved = JSON.parse(localStorage.getItem(EXPLORER_SESSION_KEY) || 'null');
        const ids = new Set();
        const tabs = Array.isArray(saved?.tabs) ? saved.tabs.filter(tab => {
            if (typeof tab?.id !== 'string' || !tab.id || ids.has(tab.id) ||
                typeof tab.path !== 'string' || !tab.path.trim()) return false;
            ids.add(tab.id);
            return true;
        }).map(({ id, path }) => ({ id, path })) : [];
        const activeTabId = tabs.some(tab => tab.id === saved?.activeTabId)
            ? saved.activeTabId : tabs[0]?.id || null;
        return { tabs, activeTabId };
    } catch (error) {
        console.error('Failed to restore explorer session:', error);
        return { tabs: [], activeTabId: null };
    }
};
