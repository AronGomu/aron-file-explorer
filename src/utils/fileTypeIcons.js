import {
    siAstro, siBlender, siBun, siC, siClojure, siCmake, siCplusplus, siCss,
    siDart, siDocker, siDotenv, siElixir, siErlang, siEslint, siGit, siGnubash,
    siGnu, siGo, siGraphql, siHaskell, siHtml5, siJavascript, siJson, siJupyter,
    siKotlin, siLatex, siLess, siLua, siMarkdown, siNixos, siNpm, siOcaml,
    siOpenjdk, siPerl, siPhp, siPnpm, siPrettier, siPrisma, siPython, siR,
    siReact, siRuby, siRust, siSass, siScala, siSvelte, siSvg, siSwift,
    siTerraform, siToml, siTypescript, siTypst, siVite, siVuedotjs,
    siWebassembly, siYaml, siYarn, siZig,
} from 'simple-icons';

const extensionIcons = new Map([
    [siMarkdown, ['md', 'markdown', 'mdown', 'mkd', 'mdx']],
    [siJavascript, ['js', 'mjs', 'cjs']],
    [siTypescript, ['ts', 'mts', 'cts']],
    [siReact, ['jsx', 'tsx']],
    [siHtml5, ['html', 'htm', 'xhtml']],
    [siCss, ['css']],
    [siSass, ['scss', 'sass']],
    [siLess, ['less']],
    [siVuedotjs, ['vue']],
    [siSvelte, ['svelte']],
    [siAstro, ['astro']],
    [siPython, ['py', 'pyw', 'pyi', 'pyc']],
    [siRust, ['rs']],
    [siGo, ['go']],
    [siC, ['c', 'h']],
    [siCplusplus, ['cpp', 'cc', 'cxx', 'hpp', 'hh', 'hxx']],
    [siOpenjdk, ['java', 'class', 'jar']],
    [siPhp, ['php', 'phtml']],
    [siRuby, ['rb', 'rake', 'gemspec']],
    [siSwift, ['swift']],
    [siKotlin, ['kt', 'kts']],
    [siDart, ['dart']],
    [siLua, ['lua']],
    [siPerl, ['pl', 'pm']],
    [siR, ['r', 'rmd']],
    [siScala, ['scala', 'sc']],
    [siClojure, ['clj', 'cljs', 'cljc', 'edn']],
    [siElixir, ['ex', 'exs']],
    [siErlang, ['erl', 'hrl']],
    [siHaskell, ['hs', 'lhs']],
    [siZig, ['zig', 'zon']],
    [siNixos, ['nix']],
    [siOcaml, ['ml', 'mli']],
    [siGnubash, ['sh', 'bash', 'zsh', 'fish']],
    [siJson, ['json', 'jsonc', 'json5']],
    [siYaml, ['yaml', 'yml']],
    [siToml, ['toml']],
    [siGraphql, ['graphql', 'gql']],
    [siPrisma, ['prisma']],
    [siTerraform, ['tf', 'tfvars']],
    [siLatex, ['tex', 'sty', 'cls', 'bib']],
    [siTypst, ['typ']],
    [siJupyter, ['ipynb']],
    [siWebassembly, ['wasm', 'wat']],
    [siCmake, ['cmake']],
    [siSvg, ['svg', 'svgz']],
    [siBlender, ['blend']],
].flatMap(([icon, extensions]) => extensions.map(extension => [extension, icon])));

const namedIcons = new Map([
    ['dockerfile', siDocker], ['containerfile', siDocker], ['.dockerignore', siDocker],
    ['compose.yaml', siDocker], ['compose.yml', siDocker],
    ['docker-compose.yaml', siDocker], ['docker-compose.yml', siDocker],
    ['.gitignore', siGit], ['.gitattributes', siGit], ['.gitmodules', siGit],
    ['package.json', siNpm], ['package-lock.json', siNpm], ['.npmrc', siNpm],
    ['yarn.lock', siYarn], ['.yarnrc', siYarn], ['.yarnrc.yml', siYarn],
    ['pnpm-lock.yaml', siPnpm], ['pnpm-workspace.yaml', siPnpm],
    ['bun.lock', siBun], ['bun.lockb', siBun],
    ['cargo.toml', siRust], ['cargo.lock', siRust],
    ['go.mod', siGo], ['go.sum', siGo], ['go.work', siGo],
    ['requirements.txt', siPython], ['pyproject.toml', siPython],
    ['pipfile', siPython], ['pipfile.lock', siPython], ['uv.lock', siPython],
    ['gemfile', siRuby], ['gemfile.lock', siRuby], ['rakefile', siRuby],
    ['cmakelists.txt', siCmake], ['makefile', siGnu], ['gnumakefile', siGnu],
    ['.bashrc', siGnubash], ['.bash_profile', siGnubash], ['.zshrc', siGnubash],
]);

const extensionBadges = new Map([
    ['cs', 'C#'], ['fs', 'F#'], ['fsx', 'F#'],
    ['xml', 'XML'], ['xsd', 'XML'], ['xsl', 'XSL'], ['xslt', 'XSL'],
    ['ps1', 'PS'], ['psm1', 'PS'], ['psd1', 'PS'], ['bat', 'BAT'], ['cmd', 'CMD'],
    ['sql', 'SQL'], ['db', 'DB'], ['sqlite', 'DB'], ['sqlite3', 'DB'],
    ['ini', 'INI'], ['cfg', 'CFG'], ['conf', 'CFG'],
    ['csv', 'CSV'], ['tsv', 'TSV'], ['pdf', 'PDF'],
    ['doc', 'W'], ['docx', 'W'], ['odt', 'ODT'], ['rtf', 'RTF'],
    ['xls', 'X'], ['xlsx', 'X'], ['ods', 'ODS'],
    ['ppt', 'P'], ['pptx', 'P'], ['odp', 'ODP'],
    ['ttf', 'Aa'], ['otf', 'Aa'], ['woff', 'Aa'], ['woff2', 'Aa'],
    ['psd', 'PS'], ['ai', 'AI'], ['eps', 'EPS'],
    ['log', 'LOG'], ['ics', 'ICS'],
    ['exe', 'EXE'], ['msi', 'MSI'], ['appimage', 'APP'],
    ['deb', 'DEB'], ['rpm', 'RPM'], ['apk', 'APK'], ['dmg', 'DMG'], ['iso', 'ISO'],
]);

/** Returns a specific format icon, ahead of the generic file category. */
export const getFileTypeIcon = (filename) => {
    const name = filename?.split(/[/\\]/).pop().toLowerCase();
    if (!name) return null;
    if (namedIcons.has(name)) return namedIcons.get(name);
    if (name === '.env' || name.startsWith('.env.')) return siDotenv;
    if (name.startsWith('dockerfile.') || name.endsWith('.dockerfile')) return siDocker;
    if (name.startsWith('tsconfig.')) return siTypescript;
    if (name.startsWith('vite.config.')) return siVite;
    if (name.startsWith('eslint.config.') || name.startsWith('.eslintrc')) return siEslint;
    if (name.startsWith('prettier.config.') || name.startsWith('.prettierrc')) return siPrettier;
    const extension = name.includes('.') ? name.split('.').pop() : '';
    if (extensionIcons.has(extension)) return extensionIcons.get(extension);
    const label = extensionBadges.get(extension);
    return label ? { label } : null;
};
