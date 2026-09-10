import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import postcss from 'postcss';
import { parse } from '@babel/parser';
import { TOKEN_TO_CSS } from '../src/themes/themeContract.js';

const legacy = /(?:\btheme-(?:light|dark|high-contrast|accent[\w-]*)\b|--(?:light|dark)-[\w-]+|\b(?:darkmode|default_theme|custom_themes|default_themes_path|accent_color)\b|--(?:accent-color|hover-color|text-color|danger|border-subtle|info-bg|info-border|warning-bg|warning-border|warning-text|success-hover|background-breadcrumb(?:-hover)?|color-white|color-black)\b)/;
const colorProperty = /^(?:--[\w-]+|color|background(?:-color|-image)?|border(?:-(?:top|right|bottom|left|(?:block|inline)(?:-(?:start|end))?))?(?:-color)?|border-image(?:-source)?|outline(?:-color)?|(?:box|text)-shadow|fill|stroke|(?:caret|accent|scrollbar|stop|flood|lighting)-color|text-(?:decoration|emphasis)(?:-color)?|column-rule(?:-color)?|(?:-webkit-)?text-(?:fill|stroke)-color|-webkit-tap-highlight-color|(?:backdrop-)?filter|(?:-webkit-)?mask(?:-image)?)$/i;
const names = new Set(('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen').split(' '));
const kebab = name => name.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);

// Ignore URLs/quoted content, but retain var() fallbacks for literal inspection.
function unquoted(value) {
    return value.replace(/url\((?:[^()"']|"[^"]*"|'[^']*')*\)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/gi, '');
}
function hasLiteral(value) {
    const clean = unquoted(value).replace(/--[\w-]+/g, '');
    if (/#[\da-f]{3,8}\b/i.test(clean)) return true;
    if ([...clean.matchAll(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(([^()]*(?:var\([^()]*\)[^()]*)*)\)/gi)].some(match => !/var\(/.test(match[1]))) return true;
    return [...clean.matchAll(/[a-z][\w-]*/gi)].some(([word]) => names.has(word.toLowerCase()));
}

export function auditSources(sources, allowlist = []) {
    const findings = [], references = [];
    const defined = new Set([...Object.values(TOKEN_TO_CSS), '--background-rgb', '--border-rgb', '--accent-rgb']);
    const usedExceptions = new Set();
    for (const entry of allowlist) {
        if (!entry || !['terminal', 'user-content', 'native-control', 'asset'].includes(entry.reason) || typeof entry.path !== 'string' || typeof entry.match !== 'string' || !entry.match || /[*?]/.test(entry.path)) throw new Error('Invalid theme color allowlist entry');
    }
    for (const [path, source] of Object.entries(sources)) {
        if (path.startsWith('src/components/terminal/')) continue;
        const report = (kind, offset, snippet) => {
            const line = source.slice(0, offset).split('\n').length;
            if (kind === 'Unapproved color literal') {
                const index = allowlist.findIndex(entry => entry.path === path && entry.match === snippet);
                if (index !== -1) { usedExceptions.add(index); return; }
            }
            const message = `${kind}: ${path}:${line}`;
            if (!findings.includes(message)) findings.push(message);
        };
        const inspect = (value, offset, snippet, colors = false, legacySyntax = false) => {
            if (legacySyntax && legacy.test(value)) report('Legacy theme reference', offset, snippet);
            for (const match of (colors ? unquoted(value) : '').matchAll(/var\(\s*(--[\w-]+)/g)) {
                if (legacy.test(match[1])) report('Legacy theme reference', offset, snippet);
                if (!/^--(?:font-|space-|radius-|transition-|z-index-|sidebar-width$|details-panel-width$|header-height$|footer-height$|toolbar-height$|[xy]$)/.test(match[1])) references.push({ token: match[1], offset, snippet, report });
            }
            if (colors && hasLiteral(value)) report('Unapproved color literal', offset, snippet);
        };
        const css = (text, base = 0) => {
            const ast = postcss.parse(text, { from: path });
            ast.walkDecls(decl => {
                if (decl.prop.startsWith('--')) defined.add(decl.prop);
                inspect(decl.value, base + decl.source.start.offset, decl.toString(), colorProperty.test(decl.prop));
                inspect(decl.prop, base + decl.source.start.offset, decl.toString(), false, true);
            });
            ast.walkRules(rule => inspect(rule.selector, base + rule.source.start.offset, rule.selector, false, true));
            ast.walkAtRules(rule => {
                inspect(rule.params, base + rule.source.start.offset, rule.toString());
                if (rule.name === 'media' && /prefers-color-scheme/.test(rule.params)) report('Legacy theme reference', base + rule.source.start.offset, rule.toString());
            });
        };
        if (path.endsWith('.css')) { css(source); continue; }
        const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
        const visit = (node, parent) => {
            if (!node || typeof node !== 'object') return;
            if (node.type === 'Identifier' && legacy.test(node.name)) report('Legacy theme reference', node.start, node.name);
            if (node.type === 'StringLiteral' || node.type === 'TemplateLiteral') {
                const value = node.type === 'StringLiteral' ? node.value : node.quasis.map(q => q.value.cooked ?? q.value.raw).join('__EXPR__');
                const snippet = source.slice(node.start, node.end);
                const key = parent?.type === 'ObjectProperty' ? parent.key.name ?? parent.key.value : parent?.type === 'AssignmentExpression' ? parent.left.property?.name ?? parent.left.property?.value : parent?.type === 'JSXAttribute' ? parent.name.name : '';
                const setter = parent?.type === 'CallExpression' && parent.callee.property?.name === 'setProperty' && parent.arguments[1] === node ? parent.arguments[0]?.value : '';
                const isValue = parent?.type !== 'ObjectProperty' || parent.value === node;
                const legacySyntax = key === 'className' || key === 'class'
                    || (parent?.type === 'ObjectProperty' && parent.key === node)
                    || (parent?.type === 'MemberExpression' && parent.property === node)
                    || (parent?.type === 'CallExpression' && parent.callee.object?.property?.name === 'classList');
                inspect(value, node.start, snippet, isValue && colorProperty.test(kebab(key || setter || '')), legacySyntax);
                // Generated style text (cssText/style tags) and HTML inline styles use same CSS parser.
                if (/[{}]/.test(value) && /[\w-]+\s*:[^;{}]+[;}]/.test(value) && !/<[\w/]/.test(value)) css(value, node.start);
                else if (key === 'cssText') css(`x {${value}}`, node.start);
                for (const match of value.matchAll(/\bstyle\s*=\s*(["'])(.*?)\1/gs)) css(`x {${match[2]}}`, node.start + match.index);
            }
            for (const [key, child] of Object.entries(node)) {
                if (key === 'loc' || key === 'tokens' || key === 'comments') continue;
                if (Array.isArray(child)) child.forEach(item => visit(item, node));
                else if (child && typeof child === 'object') visit(child, node);
            }
        };
        visit(ast);
    }
    for (const ref of references) if (!defined.has(ref.token)) ref.report('Unresolved color token', ref.offset, ref.snippet);
    allowlist.forEach((entry, index) => {
        if (!usedExceptions.has(index)) findings.push(`Unused color exception: ${entry.path}`);
    });
    return findings;
}

export function auditRepository(root = process.cwd()) {
    const sources = {};
    const walk = directory => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const path = resolve(directory, entry.name);
            if (entry.isDirectory()) walk(path);
            else if (/\.(?:css|js|jsx)$/.test(entry.name)) sources[relative(root, path)] = readFileSync(path, 'utf8');
        }
    };
    walk(resolve(root, 'src'));
    return auditSources(sources, JSON.parse(readFileSync(resolve(root, 'tests/themes/color-allowlist.json'), 'utf8')));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const findings = auditRepository();
    if (findings.length) { console.error(findings.join('\n')); process.exitCode = 1; }
    else console.log('Theme color audit passed');
}
