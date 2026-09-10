pub mod catalog;
pub mod definition;

pub const SEEDS: [(&str, &str); 2] = [
    ("catppuccin-latte", include_str!("../../resources/themes/catppuccin-latte.theme.json")),
    ("catppuccin-mocha", include_str!("../../resources/themes/catppuccin-mocha.theme.json")),
];
