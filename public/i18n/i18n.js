// GetVideosLocally interface translations.
//
// Load order: languages.js, then this file, then everything else. This file
// picks the language before the page renders, sets <html lang dir>, pulls the
// matching locale file in synchronously and exposes:
//
//   t('Download Now')                        -> translated string
//   t('Saved to {folder}', { folder })       -> with placeholders filled in
//   t.plural(n, '{count} video', '{count} videos')
//   t.translateDom(root)                     -> translate static markup
//
// English source text is the key, so untranslated strings fall back to English.
(function (root) {
    const registry = root.GVL_LANGUAGES;
    const SETTINGS_KEY = 'ytdUserSettings';
    const script = document.currentScript;
    const basePath = script && script.src ? script.src.replace(/[^/]*$/, '') : '/public/i18n/';

    function readSavedPreference() {
        try {
            const fromQuery = new URLSearchParams(location.search).get('lang');
            if (fromQuery) return fromQuery;
        } catch { /* no query string */ }
        try {
            const settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
            if (typeof settings.language === 'string') return settings.language;
        } catch { /* storage unavailable */ }
        return 'auto';
    }

    function deviceLanguages() {
        const list = Array.isArray(navigator.languages) && navigator.languages.length
            ? navigator.languages
            : [navigator.language];
        return list.filter(Boolean);
    }

    function resolveLanguage(preference) {
        if (preference && preference !== 'auto') {
            const explicit = registry.matchLanguage(preference);
            if (explicit) return explicit;
        }
        return registry.matchFirstLanguage(deviceLanguages()) || 'en';
    }

    const preference = readSavedPreference();
    const language = registry.getLanguage(resolveLanguage(preference));
    const html = document.documentElement;
    html.lang = language.code;
    html.dir = language.dir;
    html.dataset.script = language.script;

    // Parser-inserted, so it runs before the scripts that follow this one.
    if (language.code !== 'en') {
        document.write(`<script src="${basePath}locales/${language.code}.js"><\/script>`);
    }

    function messages() {
        return (root.GVL_LOCALES && root.GVL_LOCALES[language.code]) || {};
    }

    function fill(text, vars) {
        if (!vars) return text;
        return text.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
    }

    function t(source, vars) {
        const value = messages()[source];
        const text = typeof value === 'string' && value ? value : (typeof value === 'object' && value ? value.other : source);
        return fill(text || source, vars);
    }

    let pluralRules;
    try { pluralRules = new Intl.PluralRules(language.code); } catch { pluralRules = new Intl.PluralRules('en'); }

    // Key is the English plural ("other") form. A translation may be a string or
    // an object of CLDR categories: { one, two, few, many, other, zero }.
    t.plural = function plural(count, one, other, vars) {
        const values = { count, ...(vars || {}) };
        const entry = messages()[other];
        if (entry && typeof entry === 'object') {
            const category = Number(count) === 0 && entry.zero ? 'zero' : pluralRules.select(Number(count));
            return fill(entry[category] || entry.other || other, values);
        }
        if (typeof entry === 'string' && entry) return fill(entry, values);
        return fill(Number(count) === 1 ? one : other, values);
    };

    t.has = (source) => Object.prototype.hasOwnProperty.call(messages(), source);
    t.lang = language.code;
    t.dir = language.dir;
    t.script = language.script;
    t.language = language;
    t.preference = preference;
    t.languages = registry.LANGUAGES;
    t.resolveLanguage = resolveLanguage;
    t.formatNumber = (value, options) => new Intl.NumberFormat(language.code, options).format(value);
    t.formatDate = (value, options) => new Intl.DateTimeFormat(language.code, options).format(value);

    // ---- Static markup -------------------------------------------------------
    // Text nodes and a few attributes are matched on their whitespace-collapsed
    // English text. Elements with data-i18n-key are translated as one HTML unit
    // (for sentences whose word order moves a link around).
    const ATTRIBUTES = ['placeholder', 'title', 'aria-label', 'alt', 'label', 'data-tooltip'];
    const SKIP = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'TEXTAREA']);
    const originals = new WeakMap();

    function normalize(text) {
        return text.replace(/\s+/g, ' ').trim();
    }

    function translateText(node) {
        let original = originals.get(node);
        if (original === undefined) {
            original = node.nodeValue;
            originals.set(node, original);
        }
        const key = normalize(original);
        if (!key || !/[A-Za-z]/.test(key)) return;
        const translated = t(key);
        if (translated === key && node.nodeValue === original) return;
        const lead = original.match(/^\s*/)[0] ? ' ' : '';
        const trail = original.match(/\s*$/)[0] ? ' ' : '';
        node.nodeValue = lead + translated + trail;
    }

    function translateElement(element) {
        if (element.hasAttribute('data-i18n-key')) {
            let original = originals.get(element);
            if (original === undefined) {
                original = element.innerHTML;
                originals.set(element, original);
            }
            const key = element.getAttribute('data-i18n-key');
            if (!t.has(key)) { element.innerHTML = original; return true; }
            // Translations use bare tags (<a>…</a>); give the nth tag of each kind
            // the attributes of the nth matching element in the original markup.
            const source = document.createElement('template');
            source.innerHTML = original;
            const result = document.createElement('template');
            result.innerHTML = t(key);
            const seen = {};
            for (const node of result.content.querySelectorAll('*')) {
                const tag = node.tagName;
                const index = seen[tag] = (seen[tag] || 0) + 1;
                const match = source.content.querySelectorAll(tag)[index - 1];
                if (match) for (const attr of match.attributes) node.setAttribute(attr.name, attr.value);
            }
            element.replaceChildren(result.content);
            return true;
        }
        for (const attribute of ATTRIBUTES) {
            if (!element.hasAttribute(attribute)) continue;
            const store = `i18nSrc${attribute.replace(/-./g, (part) => part[1].toUpperCase())}`;
            if (!(store in element.dataset)) element.dataset[store] = element.getAttribute(attribute);
            const source = normalize(element.dataset[store]);
            if (/[A-Za-z]/.test(source)) element.setAttribute(attribute, t(source));
        }
        return false;
    }

    t.translateDom = function translateDom(rootNode) {
        const start = rootNode || document.body;
        if (!start) return;
        const visit = (node) => {
            if (node.nodeType === Node.TEXT_NODE) { translateText(node); return; }
            if (node.nodeType !== Node.ELEMENT_NODE || SKIP.has(node.tagName)) return;
            if (node.hasAttribute('data-i18n-skip')) return;
            if (translateElement(node)) return;
            for (const child of node.childNodes) visit(child);
        };
        visit(start);
        if (start === document.body) {
            const title = document.querySelector('title');
            if (title) {
                if (!title.dataset.i18nSrc) title.dataset.i18nSrc = normalize(title.textContent);
                document.title = t(title.dataset.i18nSrc);
            }
        }
    };

    root.t = t;
    root.gvlI18n = t;

    // Translate the static page as soon as it is parsed, before app scripts run
    // their DOMContentLoaded handlers and start adding their own (already
    // translated) content.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => t.translateDom(), { once: true, capture: true });
    } else {
        t.translateDom();
    }
})(typeof self !== 'undefined' ? self : this);
