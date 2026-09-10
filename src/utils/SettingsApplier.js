import { useEffect } from 'react';
import { useSettings } from '../providers/SettingsProvider';

/**
 * Component that applies settings to the DOM/CSS variables
 * This component doesn't render anything, it just applies settings as side effects
 */
const SettingsApplier = () => {
    const { settings } = useSettings();

    useEffect(() => {
        // Apply font size settings
        if (settings.font_size) {
            const fontSizeClass = `font-size-${settings.font_size.toLowerCase()}`;

            // Remove existing font size classes
            document.documentElement.classList.remove('font-size-small', 'font-size-medium', 'font-size-large');

            // Add the current font size class
            if (settings.font_size !== 'Medium') {
                document.documentElement.classList.add(fontSizeClass);
            }
        }

        // Apply animation settings
        if (settings.enable_animations_and_transitions === false) {
            document.documentElement.classList.add('reduce-motion');
        } else {
            document.documentElement.classList.remove('reduce-motion');
        }

        // Apply terminal height
        if (settings.terminal_height) {
            document.documentElement.style.setProperty('--terminal-height', `${settings.terminal_height}px`);
        }

        console.log('Settings applied to DOM:', {
            font_size: settings.font_size,
            enable_animations_and_transitions: settings.enable_animations_and_transitions,
            terminal_height: settings.terminal_height
        });

    }, [settings.font_size, settings.enable_animations_and_transitions, settings.terminal_height]);

    // This component doesn't render anything
    return null;
};

export default SettingsApplier;