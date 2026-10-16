use serde::Serialize;
use std::path::Path;
use std::sync::LazyLock;
use tree_sitter_highlight::{HighlightConfiguration, HighlightEvent, Highlighter};

const CAPTURES: &[&str] = &[
    "attribute",
    "comment",
    "constant",
    "constructor",
    "embedded",
    "escape",
    "function",
    "keyword",
    "label",
    "module",
    "number",
    "operator",
    "property",
    "punctuation",
    "string",
    "tag",
    "type",
    "variable",
    "none",
    "text.title",
    "text.literal",
    "text.uri",
    "text.reference",
    "text.emphasis",
    "text.strong",
];

#[derive(Serialize)]
pub struct HighlightedText {
    pub text: String,
    pub kind: Option<&'static str>,
}

// Each grammar compiles its queries once, on first use, including embedded languages.
macro_rules! configuration {
    ($language:expr, $name:literal, $highlights:expr, $injections:expr, $locals:expr) => {{
        static CONFIG: LazyLock<Option<HighlightConfiguration>> = LazyLock::new(|| {
            let mut config = HighlightConfiguration::new(
                $language.into(),
                $name,
                &$highlights,
                $injections,
                $locals,
            )
            .ok()?;
            config.configure(CAPTURES);
            Some(config)
        });
        CONFIG.as_ref()
    }};
}

fn language_configuration(name: &str) -> Option<&'static HighlightConfiguration> {
    match name {
        "javascript" | "js" | "jsx" => configuration!(
            tree_sitter_javascript::LANGUAGE,
            "javascript",
            format!(
                "{}\n{}",
                tree_sitter_javascript::HIGHLIGHT_QUERY,
                tree_sitter_javascript::JSX_HIGHLIGHT_QUERY
            ),
            tree_sitter_javascript::INJECTIONS_QUERY,
            tree_sitter_javascript::LOCALS_QUERY
        ),
        "typescript" | "ts" => configuration!(
            tree_sitter_typescript::LANGUAGE_TYPESCRIPT,
            "typescript",
            format!(
                "{}\n{}",
                tree_sitter_javascript::HIGHLIGHT_QUERY,
                tree_sitter_typescript::HIGHLIGHTS_QUERY
            ),
            "",
            tree_sitter_typescript::LOCALS_QUERY
        ),
        "tsx" => configuration!(
            tree_sitter_typescript::LANGUAGE_TSX,
            "tsx",
            format!(
                "{}\n{}\n{}",
                tree_sitter_javascript::HIGHLIGHT_QUERY,
                tree_sitter_javascript::JSX_HIGHLIGHT_QUERY,
                tree_sitter_typescript::HIGHLIGHTS_QUERY
            ),
            "",
            tree_sitter_typescript::LOCALS_QUERY
        ),
        "python" | "py" => configuration!(
            tree_sitter_python::LANGUAGE,
            "python",
            tree_sitter_python::HIGHLIGHTS_QUERY,
            "",
            ""
        ),
        "rust" | "rs" => configuration!(
            tree_sitter_rust::LANGUAGE,
            "rust",
            tree_sitter_rust::HIGHLIGHTS_QUERY,
            tree_sitter_rust::INJECTIONS_QUERY,
            ""
        ),
        "json" | "jsonc" => configuration!(
            tree_sitter_json::LANGUAGE,
            "json",
            tree_sitter_json::HIGHLIGHTS_QUERY,
            "",
            ""
        ),
        "html" => configuration!(
            tree_sitter_html::LANGUAGE,
            "html",
            tree_sitter_html::HIGHLIGHTS_QUERY,
            tree_sitter_html::INJECTIONS_QUERY,
            ""
        ),
        "css" => configuration!(
            tree_sitter_css::LANGUAGE,
            "css",
            tree_sitter_css::HIGHLIGHTS_QUERY,
            "",
            ""
        ),
        "bash" | "sh" | "shell" | "zsh" => configuration!(
            tree_sitter_bash::LANGUAGE,
            "bash",
            tree_sitter_bash::HIGHLIGHT_QUERY,
            "",
            ""
        ),
        "yaml" | "yml" => configuration!(
            tree_sitter_yaml::LANGUAGE,
            "yaml",
            tree_sitter_yaml::HIGHLIGHTS_QUERY,
            "",
            ""
        ),
        "toml" => configuration!(
            tree_sitter_toml_ng::LANGUAGE,
            "toml",
            tree_sitter_toml_ng::HIGHLIGHTS_QUERY,
            "",
            ""
        ),
        "markdown" | "md" => configuration!(
            tree_sitter_md::LANGUAGE,
            "markdown",
            tree_sitter_md::HIGHLIGHT_QUERY_BLOCK,
            tree_sitter_md::INJECTION_QUERY_BLOCK,
            ""
        ),
        "markdown_inline" => configuration!(
            tree_sitter_md::INLINE_LANGUAGE,
            "markdown_inline",
            tree_sitter_md::HIGHLIGHT_QUERY_INLINE,
            tree_sitter_md::INJECTION_QUERY_INLINE,
            ""
        ),
        "c" => configuration!(
            tree_sitter_c::LANGUAGE,
            "c",
            tree_sitter_c::HIGHLIGHT_QUERY,
            "",
            ""
        ),
        "cpp" | "c++" => configuration!(
            tree_sitter_cpp::LANGUAGE,
            "cpp",
            format!(
                "{}\n{}",
                tree_sitter_c::HIGHLIGHT_QUERY,
                tree_sitter_cpp::HIGHLIGHT_QUERY
            ),
            "",
            ""
        ),
        "go" => configuration!(
            tree_sitter_go::LANGUAGE,
            "go",
            tree_sitter_go::HIGHLIGHTS_QUERY,
            "",
            ""
        ),
        "java" => configuration!(
            tree_sitter_java::LANGUAGE,
            "java",
            tree_sitter_java::HIGHLIGHTS_QUERY,
            "",
            ""
        ),
        "lua" => configuration!(
            tree_sitter_lua::LANGUAGE,
            "lua",
            tree_sitter_lua::HIGHLIGHTS_QUERY,
            tree_sitter_lua::INJECTIONS_QUERY,
            tree_sitter_lua::LOCALS_QUERY
        ),
        "nix" => configuration!(
            tree_sitter_nix::LANGUAGE,
            "nix",
            tree_sitter_nix::HIGHLIGHTS_QUERY,
            tree_sitter_nix::INJECTIONS_QUERY,
            ""
        ),
        _ => None,
    }
}

fn file_language(path: &str, source: &str) -> Option<&'static str> {
    let name = Path::new(path).file_name()?.to_str()?.to_lowercase();
    match name.as_str() {
        "cargo.lock" => return Some("toml"),
        "flake.lock" => return Some("json"),
        ".bashrc" | ".bash_profile" | ".zshrc" | ".profile" | ".env" => return Some("bash"),
        _ => {}
    }
    let language = match name.rsplit('.').next()? {
        "js" | "mjs" | "cjs" | "jsx" => "javascript",
        "ts" | "mts" | "cts" => "typescript",
        "tsx" => "tsx",
        "py" | "pyi" => "python",
        "rs" => "rust",
        "json" | "jsonc" | "ipynb" | "geojson" => "json",
        "html" | "htm" => "html",
        "css" => "css",
        "sh" | "bash" | "zsh" => "bash",
        "yaml" | "yml" => "yaml",
        "toml" => "toml",
        "md" | "markdown" | "mdown" | "mkd" | "mdx" => "markdown",
        "c" | "h" => "c",
        "cc" | "cpp" | "cxx" | "hh" | "hpp" | "hxx" => "cpp",
        "go" => "go",
        "java" => "java",
        "lua" => "lua",
        "nix" => "nix",
        _ => {
            let shebang = source.lines().next()?.strip_prefix("#!")?;
            if shebang.contains("python") {
                "python"
            } else if shebang.contains("node") {
                "javascript"
            } else if shebang
                .split_whitespace()
                .any(|word| matches!(word.rsplit('/').next(), Some("sh" | "bash" | "zsh")))
            {
                "bash"
            } else {
                return None;
            }
        }
    };
    Some(language)
}

pub fn highlight_text(path: &str, source: &str) -> Option<Vec<HighlightedText>> {
    let config = language_configuration(file_language(path, source)?)?;
    let mut highlighter = Highlighter::new();
    let events = highlighter
        .highlight(config, source.as_bytes(), None, None, |name| {
            language_configuration(name)
        })
        .ok()?;
    let mut stack = Vec::new();
    let mut segments: Vec<HighlightedText> = Vec::new();
    for event in events {
        match event.ok()? {
            HighlightEvent::HighlightStart(highlight) => stack.push(CAPTURES[highlight.0]),
            HighlightEvent::HighlightEnd => {
                stack.pop();
            }
            HighlightEvent::Source { start, end } => {
                let text = source.get(start..end)?;
                let kind = stack.last().copied();
                if let Some(previous) = segments.last_mut().filter(|previous| previous.kind == kind)
                {
                    previous.text.push_str(text);
                } else {
                    // Keep large or minified previews from creating an excessive number of DOM nodes.
                    if segments.len() >= 32_768 {
                        return None;
                    }
                    segments.push(HighlightedText {
                        text: text.to_owned(),
                        kind,
                    });
                }
            }
        }
    }
    Some(segments)
}
