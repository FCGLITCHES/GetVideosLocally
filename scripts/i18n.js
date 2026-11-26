#!/usr/bin/env node
// Interface translation tooling.
//
//   node scripts/i18n.js extract   Collect every English string into i18n/en.json
//   node scripts/i18n.js build     Turn i18n/<code>.json into public/i18n/locales/<code>.js
//   node scripts/i18n.js check     Report missing or broken translations (exit 1 on problems)
//
// Strings come from static HTML (text nodes, a few attributes, data-i18n-key
// blocks) and from t('...') / t.plural(n, '...', '...') / mainT('...') calls.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCE_DIR = path.join(ROOT, 'i18n');
const OUTPUT_DIR = path.join(ROOT, 'public', 'i18n', 'locales');
const { LANGUAGES } = require(path.join(ROOT, 'public', 'i18n', 'languages.js'));

const HTML_FILES = ['index.html', 'public/contact.html', 'public/cookies.html', 'public/legal-guide.html', 'public/terms.html'];
const JS_FILES = [
    'script.js',
    'electron-main.js',
    'server.js',
    'public/local-api-auth.js',
    'public/download-dismissals.js',
    'public/content-filter-client.js',
    ...listJs('backend')
];
const ATTRIBUTES = ['placeholder', 'title', 'aria-label', 'alt', 'label', 'data-tooltip'];

function listJs(dir) {
    const full = path.join(ROOT, dir);
    if (!fs.existsSync(full)) return [];
    return fs.readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
        const relative = path.posix.join(dir, entry.name);
        if (entry.isDirectory()) return listJs(relative);
        return entry.name.endsWith('.js') ? [relative] : [];
    });
}

const normalize = (text) => text.replace(/\s+/g, ' ').trim();
const hasWords = (text) => /[A-Za-z]/.test(text);

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', times: '×', middot: '·', bull: '•', rarr: '→', larr: '←', hellip: '…', mdash: '—', ndash: '–', reg: '®', trade: '™', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
function decodeEntities(text) {
    return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body) => {
        if (body[0] === '#') {
            const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
            return String.fromCodePoint(code);
        }
        return ENTITIES[body.toLowerCase()] ?? match;
    });
}

function extractHtml(source, add) {
    const html = source.replace(/<!--[\s\S]*?-->/g, '');
    // Whole-HTML blocks first, then blank them so their inner text is not added twice.
    const keyed = /<([a-z0-9-]+)\b([^>]*\bdata-i18n-key="([^"]+)"[^>]*)>/gi;
    let working = html;
    let match;
    while ((match = keyed.exec(html))) {
        const tag = match[1];
        const start = match.index + match[0].length;
        const end = findClose(html, tag, start);
        // The key carries bare tags (<a>…</a>); attributes come from the markup at runtime.
        const key = decodeEntities(match[3]);
        add(key, key, 'html');
        working = working.slice(0, start) + ' '.repeat(end - start) + working.slice(end);
    }
    working = working
        .replace(/<script\b[\s\S]*?<\/script>/gi, (block) => ' '.repeat(block.length))
        .replace(/<style\b[\s\S]*?<\/style>/gi, (block) => ' '.repeat(block.length))
        .replace(/<(code|pre|textarea)\b[\s\S]*?<\/\1>/gi, (block) => ' '.repeat(block.length));
    // Elements marked data-i18n-skip keep their children out of the catalog.
    const skipped = /<([a-z0-9-]+)\b[^>]*\bdata-i18n-skip\b[^>]*>/gi;
    while ((match = skipped.exec(working))) {
        const start = match.index + match[0].length;
        const end = findClose(working, match[1], start);
        working = working.slice(0, start) + ' '.repeat(end - start) + working.slice(end);
    }
    const title = working.match(/<title>([\s\S]*?)<\/title>/i);
    if (title) add(normalize(decodeEntities(title[1])));
    const body = working.replace(/<head>[\s\S]*?<\/head>/i, '');
    for (const text of body.split(/<[^>]*>/)) {
        const value = normalize(decodeEntities(text));
        if (value && hasWords(value)) add(value);
    }
    const tagRe = /<[a-z][^>]*>/gi;
    while ((match = tagRe.exec(body))) {
        for (const attribute of ATTRIBUTES) {
            const attr = match[0].match(new RegExp(`\\s${attribute}="([^"]*)"`, 'i'));
            if (attr) {
                const value = normalize(decodeEntities(attr[1]));
                if (value && hasWords(value)) add(value);
            }
        }
    }
}

function findClose(html, tag, from) {
    const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
    re.lastIndex = from;
    let depth = 1;
    let match;
    while ((match = re.exec(html))) {
        depth += match[1] ? -1 : 1;
        if (depth === 0) return match.index;
    }
    throw new Error(`Unclosed <${tag}> at ${from}`);
}

const STRING = String.raw`(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|` + '`(?:\\\\.|[^`\\\\])*`)';
function unquote(literal, file) {
    const quote = literal[0];
    const body = literal.slice(1, -1);
    if (quote === '`' && body.includes('${')) {
        throw new Error(`${file}: t() needs {placeholders}, not \${} interpolation: ${literal.slice(0, 80)}`);
    }
    return body.replace(/\\(u\{[0-9a-f]+\}|u[0-9a-f]{4}|x[0-9a-f]{2}|.)/gi, (match, escape) => {
        if (escape[0] === 'u' && escape.length > 1) return String.fromCodePoint(parseInt(escape.replace(/[u{}]/g, ''), 16));
        if (escape[0] === 'x' && escape.length === 3) return String.fromCharCode(parseInt(escape.slice(1), 16));
        return { n: '\n', t: '\t', r: '\r', '0': '\0' }[escape] ?? escape;
    });
}

function extractJs(source, file, add) {
    // Not obj.t(...), but a spread ...uiMessage(...) counts.
    const single = new RegExp(String.raw`(?<![\w$])(?<![^.]\.)(?:t|mainT|tr|uiMessage|uiError)\(\s*(${STRING})`, 'g');
    const plural = new RegExp(String.raw`(?<![\w$])(?:t|mainT|tr)\.plural\(\s*[^,]+?,\s*(${STRING})\s*,\s*(${STRING})`, 'g');
    let match;
    while ((match = single.exec(source))) add(unquote(match[1], file));
    while ((match = plural.exec(source))) add(unquote(match[2], file), { one: unquote(match[1], file), other: unquote(match[2], file) });
}

function extract() {
    const catalog = {};
    const add = (key, value, kind) => {
        if (!key) return;
        if (kind === 'html') { catalog[key] = value; return; }
        if (value && typeof value === 'object') { catalog[key] = value; return; }
        if (!(key in catalog)) catalog[key] = key;
    };
    for (const file of HTML_FILES) {
        const full = path.join(ROOT, file);
        if (!fs.existsSync(full)) continue;
        const source = fs.readFileSync(full, 'utf8');
        extractHtml(source, add);
        extractJs(source, file, add); // inline <script> blocks
    }
    for (const file of JS_FILES) {
        const full = path.join(ROOT, file);
        if (fs.existsSync(full)) extractJs(fs.readFileSync(full, 'utf8'), file, add);
    }
    const sorted = Object.fromEntries(Object.keys(catalog).sort((a, b) => a.localeCompare(b)).map((key) => [key, catalog[key]]));
    fs.mkdirSync(SOURCE_DIR, { recursive: true });
    fs.writeFileSync(path.join(SOURCE_DIR, 'en.json'), `${JSON.stringify(sorted, null, 2)}\n`);
    console.log(`i18n/en.json: ${Object.keys(sorted).length} strings`);
    return sorted;
}

const placeholders = (text) => (String(text).match(/\{\w+\}/g) || []).sort().join(',');
const tags = (text) => (String(text).match(/<\/?[a-z][a-z0-9]*/gi) || []).map((tag) => tag.toLowerCase()).sort().join(',');

function validate(code, english, translated) {
    const problems = [];
    let missing = 0;
    for (const [key, source] of Object.entries(english)) {
        const value = translated[key];
        if (value === undefined || value === '') { missing += 1; continue; }
        const sourceText = typeof source === 'object' ? source.other : source;
        const forms = typeof value === 'object' ? Object.values(value) : [value];
        if (typeof value === 'object' && !value.other) problems.push(`${code}: plural without "other": ${key}`);
        for (const form of forms) {
            if (typeof form !== 'string') { problems.push(`${code}: non-string value for ${key}`); continue; }
            const wanted = placeholders(sourceText).split(',').filter((name) => name && name !== '{count}');
            for (const name of wanted) if (!form.includes(name)) problems.push(`${code}: lost ${name} in "${key}"`);
            if (tags(form) !== tags(sourceText)) problems.push(`${code}: HTML tags differ in "${key}"`);
        }
    }
    return { missing, problems };
}

function build() {
    const english = JSON.parse(fs.readFileSync(path.join(SOURCE_DIR, 'en.json'), 'utf8'));
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    let failed = false;
    for (const { code } of LANGUAGES) {
        if (code === 'en') continue;
        const file = path.join(SOURCE_DIR, `${code}.json`);
        if (!fs.existsSync(file)) { console.warn(`${code}: no translation file`); continue; }
        const translated = JSON.parse(fs.readFileSync(file, 'utf8'));
        const { missing, problems } = validate(code, english, translated);
        problems.forEach((problem) => console.warn(problem));
        if (problems.length) failed = true;
        const kept = Object.fromEntries(Object.entries(translated).filter(([key, value]) => key in english && value !== ''));
        const body = JSON.stringify(kept);
        fs.writeFileSync(path.join(OUTPUT_DIR, `${code}.js`),
            `// Generated by scripts/i18n.js from i18n/${code}.json. Do not edit.\n` +
            `(function (r) { var m = ${body}; if (typeof module === 'object' && module.exports) module.exports = m; ` +
            `else (r.GVL_LOCALES = r.GVL_LOCALES || {})[${JSON.stringify(code)}] = m; })(typeof self !== 'undefined' ? self : this);\n`);
        console.log(`${code}: ${Object.keys(kept).length}/${Object.keys(english).length}${missing ? ` (${missing} missing)` : ''}`);
    }
    return !failed;
}

function check() {
    const before = fs.existsSync(path.join(SOURCE_DIR, 'en.json')) ? fs.readFileSync(path.join(SOURCE_DIR, 'en.json'), 'utf8') : '';
    extract();
    const after = fs.readFileSync(path.join(SOURCE_DIR, 'en.json'), 'utf8');
    if (before && before !== after) console.warn('i18n/en.json was out of date and has been refreshed');
    const english = JSON.parse(after);
    let ok = true;
    for (const { code } of LANGUAGES) {
        if (code === 'en') continue;
        const file = path.join(SOURCE_DIR, `${code}.json`);
        if (!fs.existsSync(file)) { console.warn(`${code}: missing file`); ok = false; continue; }
        const { missing, problems } = validate(code, english, JSON.parse(fs.readFileSync(file, 'utf8')));
        if (missing) { console.warn(`${code}: ${missing} missing`); ok = false; }
        if (problems.length) { problems.forEach((problem) => console.warn(problem)); ok = false; }
    }
    if (ok) console.log('All translations complete.');
    return ok;
}

module.exports = { extract, build, check, extractHtml, extractJs, normalize };

if (require.main === module) {
    const command = process.argv[2];
    if (command === 'extract') extract();
    else if (command === 'build') process.exitCode = build() ? 0 : 1;
    else if (command === 'check') process.exitCode = check() ? 0 : 1;
    else { console.log('Usage: node scripts/i18n.js extract|build|check'); process.exitCode = 1; }
}
