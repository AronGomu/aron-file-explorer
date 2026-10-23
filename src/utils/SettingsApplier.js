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
        document.documentElement.style.setProperty('--item-font-size', `${settings.font_size}px`);

        // Apply animation settings
        if (settings.enable_animations_and_transitions === false) {
            document.documentElement.classList.add('reduce-motion');
        } else {
            document.documentElement.classList.remove('reduce-motion');
        }

        console.log('Settings applied to DOM:', {
            font_size: settings.font_size,
            enable_animations_and_transitions: settings.enable_animations_and_transitions
        });

    }, [settings.font_size, settings.enable_animations_and_transitions]);

    // This component doesn't render anything
    return null;
};

export default SettingsApplier;
