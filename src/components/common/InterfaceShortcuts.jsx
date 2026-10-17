import React, { useEffect, useState } from 'react';
import { focusItemPane, isEditingTarget } from '../../utils/explorerFocus';
import './interfaceShortcuts.css';

const REGIONS = [
    ['T', '.toolbar, .tab-bar'],
    ['L', '#explorer-sidebar'],
    ['R', '#explorer-preview-panel'],
];
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const labelAt = index => ALPHABET[Math.floor(index / 26)] + ALPHABET[index % 26];

export default function InterfaceShortcuts() {
    const [tips, setTips] = useState([]);
    const [prefix, setPrefix] = useState('');
    useEffect(() => {
        let active = false;
        let sequence = '';
        let entries = [];
        const close = () => { active = false; sequence = ''; setTips([]); setPrefix(''); };
        const collect = () => REGIONS.flatMap(([region, selector]) => {
            const roots = [...document.querySelectorAll(selector)];
            const controls = [...new Set(roots.flatMap(root => [...root.querySelectorAll('button, [role="button"], .sidebar-item')]))]
                .filter(element => {
                    const rect = element.getBoundingClientRect();
                    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight &&
                        rect.right > 0 && rect.left < innerWidth && getComputedStyle(element).visibility !== 'hidden';
                });
            const positions = [];
            return controls.map((element, index) => {
                const key = region + (controls.length > 26 ? labelAt(index) : ALPHABET[index]);
                const rect = element.getBoundingClientRect();
                const title = (element.getAttribute('title') || element.getAttribute('aria-label') || element.textContent.trim())
                    .replace(/ \(F10, [TLR][A-Z]{1,2}\)$/, '');
                element.dataset.shortcutKeytip = key;
                element.title = `${title} (F10, ${key})`;
                const x = Math.max(0, Math.min(innerWidth - 48,
                    element.matches('.sidebar-item') ? rect.left + 8 : rect.right - 28));
                let y = Math.max(0, Math.min(innerHeight - 24, rect.top));
                while (positions.some(point => Math.abs(point.x - x) < 36 && Math.abs(point.y - y) < 22)) y += 22;
                y = Math.min(innerHeight - 24, y);
                positions.push({ x, y });
                return { element, key, x, y,
                    label: element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent.trim(),
                    disabled: element.disabled || element.getAttribute('aria-disabled') === 'true' };
            });
        });
        const handle = event => {
            if (event.isComposing || document.querySelector('[role="dialog"], .modal-overlay, .context-menu')) { close(); return; }
            if (event.key === 'F10' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
                event.preventDefault(); event.stopImmediatePropagation();
                if (event.repeat) return;
                if (active) { close(); focusItemPane(); }
                else { active = true; entries = collect(); sequence = ''; setPrefix(''); setTips(entries); }
                return;
            }
            if (!active) return;
            event.preventDefault(); event.stopImmediatePropagation();
            if (event.key === 'Escape') { close(); focusItemPane(); return; }
            if (event.key === 'Backspace') sequence = sequence.slice(0, -1);
            else if (/^[a-z]$/i.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) sequence += event.key.toUpperCase();
            else return;
            const matches = entries.filter(entry => entry.key.startsWith(sequence));
            if (!matches.length) sequence = '';
            setPrefix(sequence);
            const entry = entries.find(entry => entry.key === sequence);
            if (entry) {
                close();
                if (!entry.disabled && entry.element.isConnected) entry.element.click();
                requestAnimationFrame(() => { if (!isEditingTarget(document.activeElement)) focusItemPane(); });
            }
        };
        const closeOnPointer = () => close();
        window.addEventListener('keydown', handle, true);
        window.addEventListener('pointerdown', closeOnPointer, true);
        window.addEventListener('resize', closeOnPointer);
        window.addEventListener('scroll', closeOnPointer, true);
        return () => {
            window.removeEventListener('keydown', handle, true);
            window.removeEventListener('pointerdown', closeOnPointer, true);
            window.removeEventListener('resize', closeOnPointer);
            window.removeEventListener('scroll', closeOnPointer, true);
        };
    }, []);
    if (!tips.length) return null;
    return <div className="interface-keytips" role="region" aria-label="Button keyboard shortcuts">
        <div className="interface-keytips-guide" role="status">F10 · Type a label · T: toolbar · L: left panel · R: right panel · Esc: cancel</div>
        {tips.filter(tip => tip.key.startsWith(prefix)).map(tip => <kbd key={tip.key}
            className={tip.disabled ? 'interface-keytip disabled' : 'interface-keytip'}
            style={{ left: tip.x, top: tip.y }} title={tip.label} data-keytip={tip.key}>{tip.key}</kbd>)}
    </div>;
}
