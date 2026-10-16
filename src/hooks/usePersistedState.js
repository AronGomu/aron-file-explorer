import { useEffect, useState } from 'react';

export default function usePersistedState(key, initialValue) {
    const [value, setValue] = useState(() => {
        const fallback = typeof initialValue === 'function' ? initialValue() : initialValue;
        try {
            const saved = JSON.parse(localStorage.getItem(key));
            if (typeof saved === typeof fallback &&
                (typeof saved !== 'number' || Number.isFinite(saved))) return saved;
        } catch (error) {
            console.error(`Failed to restore ${key}:`, error);
        }
        return fallback;
    });

    useEffect(() => {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (error) {
            console.error(`Failed to save ${key}:`, error);
        }
    }, [key, value]);

    return [value, setValue];
}
