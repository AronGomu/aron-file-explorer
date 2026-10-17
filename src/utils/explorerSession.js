export const EXPLORER_SESSION_KEY = 'fileExplorerSession';
export const LAST_LOCATION_KEY = 'fileExplorerLastLocation';
export const DIRECTORY_SCROLL_KEY = 'fileExplorerDirectoryScroll';

export const readDirectoryScrollPositions = () => {
    try {
        const saved = JSON.parse(localStorage.getItem(DIRECTORY_SCROLL_KEY) || '[]');
        const entries = Array.isArray(saved) ? saved.filter(entry =>
            Array.isArray(entry) && typeof entry[0] === 'string' && entry[0].trim() &&
            [entry[1]?.scrollTop, entry[1]?.scrollLeft].every(value => Number.isFinite(value) && value >= 0)
        ) : [];
        return new Map(entries.slice(-100).map(([path, { scrollTop, scrollLeft }]) =>
            [path, { scrollTop, scrollLeft }]));
    } catch (error) {
        console.error('Failed to restore directory scroll positions:', error);
        return new Map();
    }
};

export const writeDirectoryScrollPositions = (states) => {
    try {
        const positions = Array.from(states).slice(-100).map(([path, { scrollTop, scrollLeft }]) =>
            [path, { scrollTop, scrollLeft }]);
        localStorage.setItem(DIRECTORY_SCROLL_KEY, JSON.stringify(positions));
    } catch (error) {
        console.error('Failed to save directory scroll positions:', error);
    }
};

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
