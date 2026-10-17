pub mod catalog;
pub mod definition;
pub mod watcher;

pub const SEEDS: [(&str, &str); 26] = [
    ("catppuccin-latte", include_str!("../../resources/themes/catppuccin-latte.theme.json")),
    ("catppuccin-mocha", include_str!("../../resources/themes/catppuccin-mocha.theme.json")),
    ("dracula", include_str!("../../resources/themes/dracula.theme.json")),
    ("alucard", include_str!("../../resources/themes/alucard.theme.json")),
    ("nord", include_str!("../../resources/themes/nord.theme.json")),
    ("gruvbox-dark", include_str!("../../resources/themes/gruvbox-dark.theme.json")),
    ("gruvbox-light", include_str!("../../resources/themes/gruvbox-light.theme.json")),
    ("solarized-dark", include_str!("../../resources/themes/solarized-dark.theme.json")),
    ("solarized-light", include_str!("../../resources/themes/solarized-light.theme.json")),
    ("tokyo-night-night", include_str!("../../resources/themes/tokyo-night-night.theme.json")),
    ("tokyo-night-storm", include_str!("../../resources/themes/tokyo-night-storm.theme.json")),
    ("tokyo-night-moon", include_str!("../../resources/themes/tokyo-night-moon.theme.json")),
    ("tokyo-night-day", include_str!("../../resources/themes/tokyo-night-day.theme.json")),
    ("rose-pine-main", include_str!("../../resources/themes/rose-pine-main.theme.json")),
    ("rose-pine-moon", include_str!("../../resources/themes/rose-pine-moon.theme.json")),
    ("rose-pine-dawn", include_str!("../../resources/themes/rose-pine-dawn.theme.json")),
    ("one-dark", include_str!("../../resources/themes/one-dark.theme.json")),
    ("one-light", include_str!("../../resources/themes/one-light.theme.json")),
    ("everforest-dark", include_str!("../../resources/themes/everforest-dark.theme.json")),
    ("everforest-light", include_str!("../../resources/themes/everforest-light.theme.json")),
    ("github-dark-default", include_str!("../../resources/themes/github-dark-default.theme.json")),
    ("github-light-default", include_str!("../../resources/themes/github-light-default.theme.json")),
    ("monokai-classic", include_str!("../../resources/themes/monokai-classic.theme.json")),
    ("kanagawa-wave", include_str!("../../resources/themes/kanagawa-wave.theme.json")),
    ("kanagawa-dragon", include_str!("../../resources/themes/kanagawa-dragon.theme.json")),
    ("kanagawa-lotus", include_str!("../../resources/themes/kanagawa-lotus.theme.json")),
];
