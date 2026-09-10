import React, { createContext, useContext, useState, useEffect, useLayoutEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useSettings } from './SettingsProvider';
import { showError } from '../utils/NotificationSystem';
import { resolveThemeId, validateThemeDefinition } from '../themes/themeContract';
import { applyThemeToDOM, systemTheme } from '../themes/applyTheme';

const ThemeContext = createContext(null);
const compareCodepoints = (a, b) => {
    const left = [...a], right = [...b];
    for (let i = 0; i < Math.min(left.length, right.length); i++) {
        const difference = left[i].codePointAt(0) - right[i].codePointAt(0);
        if (difference) return difference;
    }
    return left.length - right.length;
};
const rank = id => ['catppuccin-latte', 'catppuccin-mocha'].indexOf(id);

export default function ThemeProvider({ children }) {
    const { settings, updateSetting } = useSettings();
    const [prefersDark, setPrefersDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
    const [catalog, setCatalog] = useState({ revision: 0, themes: [], issues: [], directory: '' });
    const [isLoading, setIsLoading] = useState(true);
    const [pending, setPending] = useState(null);
    const busy = useRef(false);
    const [rendered, setRendered] = useState(() => systemTheme(prefersDark));
    const renderedRef = useRef(rendered);
    const notices = useRef(new Set());
    const activeThemeId = pending ?? settings.active_theme_id;
    const themes = [...catalog.themes].sort((a, b) => {
        const ar = rank(a.id), br = rank(b.id);
        if (ar !== br && (ar >= 0 || br >= 0)) return (ar < 0 ? 2 : ar) - (br < 0 ? 2 : br);
        return compareCodepoints(a.name, b.name) || compareCodepoints(a.id, b.id);
    });

    useEffect(() => {
        const media = window.matchMedia('(prefers-color-scheme: dark)');
        const changed = event => setPrefersDark(event.matches);
        media.addEventListener('change', changed);
        setPrefersDark(media.matches);
        return () => media.removeEventListener('change', changed);
    }, []);

    useEffect(() => {
        let alive = true;
        invoke('get_theme_catalog').then(snapshot => {
            if (!alive) return;
            const valid = snapshot.themes.every(theme => validateThemeDefinition(theme).ok);
            if (!valid) throw new Error('Invalid theme catalog');
            setCatalog(previous => snapshot.revision > previous.revision ? snapshot : previous);
        }).catch(() => {
            if (alive) setCatalog(previous => ({ ...previous, issues: [{ code: 'io', file: null, id: null, reason: '' }] }));
        }).finally(() => { if (alive) setIsLoading(false); });
        return () => { alive = false; };
    }, []);

    useLayoutEffect(() => {
        const target = resolveThemeId(activeThemeId, prefersDark);
        const definition = catalog.themes.find(theme => theme.id === target);
        if (definition) {
            renderedRef.current = definition;
            setRendered(definition);
            applyThemeToDOM(definition);
        } else if (isLoading) {
            applyThemeToDOM(renderedRef.current);
        }
    }, [activeThemeId, prefersDark, catalog, isLoading]);

    useEffect(() => {
        if (isLoading || pending !== null) return;
        const name = renderedRef.current.name;
        const issueMessage = issue => {
            switch (issue.code) {
                case 'invalid': return `Invalid theme file "${issue.file}": ${issue.reason}. Keeping "${name}".`;
                case 'duplicate': return `Duplicate theme id "${issue.id}" in "${issue.file}". File ignored.`;
                case 'missing': return `Theme "${issue.id}" is unavailable. Keeping "${name}".`;
                case 'watch': return `Theme hot reload is unavailable. Keeping "${name}".`;
                default: return `Theme directory is unavailable. Keeping "${name}".`;
            }
        };
        const messages = catalog.issues.map(issue => [JSON.stringify(issue), issueMessage(issue)]);
        const target = resolveThemeId(activeThemeId, prefersDark);
        if (!catalog.themes.some(theme => theme.id === target)) {
            messages.push([`missing:${target}`, `Theme "${target}" is unavailable. Keeping "${name}".`]);
        }
        for (const [key, message] of messages) if (!notices.current.has(key)) showError(message, 5000);
        notices.current = new Set(messages.map(([key]) => key));
    }, [catalog, activeThemeId, prefersDark, isLoading, pending]);

    const setTheme = async id => {
        if (busy.current || isLoading || id === activeThemeId) return;
        const previous = renderedRef.current;
        const definition = catalog.themes.find(theme => theme.id === resolveThemeId(id, prefersDark));
        if (id !== 'system' && !definition) {
            showError(`Theme "${id}" is unavailable. Keeping "${previous.name}".`, 5000);
            return;
        }
        busy.current = true;
        setPending(id);
        if (definition) {
            renderedRef.current = definition;
            setRendered(definition);
            applyThemeToDOM(definition);
        }
        try {
            await updateSetting('active_theme_id', id);
        } catch (failure) {
            renderedRef.current = previous;
            setRendered(previous);
            applyThemeToDOM(previous);
            const message = failure?.code === 'unavailable'
                ? `Theme "${id}" is unavailable. Keeping "${previous.name}".`
                : `Could not save theme selection. Keeping "${previous.name}".`;
            showError(message, 5000);
        } finally {
            busy.current = false;
            setPending(null);
        }
    };

    return (
        <ThemeContext.Provider value={{ activeThemeId, resolvedThemeId: rendered.id, themes,
            themeDirectory: catalog.directory, isLoading, isSaving: pending !== null, setTheme }}>
            {isLoading ? (
                <div className="theme-loading" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
                    height: '100vh', width: '100vw', backgroundColor: 'var(--background)',
                    color: 'var(--text-secondary)', flexDirection: 'column', gap: '16px' }}>
                    <div style={{ width: '48px', height: '48px', border: '5px solid var(--border)',
                        borderTopColor: 'var(--focus-ring)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                    <div style={{ fontSize: '14px' }}>Loading theme...</div>
                    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                </div>
            ) : children}
        </ThemeContext.Provider>
    );
}

export const useTheme = () => useContext(ThemeContext);
