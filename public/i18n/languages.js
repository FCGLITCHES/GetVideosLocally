// Languages GetVideosLocally ships in. Shared by the window (i18n.js), the
// Electron main process and the i18n build scripts, so keep it dependency-free.
(function (root) {
    // code, English name, native name, script (drives the font), text direction
    const LANGUAGES = [
        ['en', 'English', 'English', 'latin', 'ltr'],
        ['ar', 'Arabic', 'العربية', 'arabic', 'rtl'],
        ['bg', 'Bulgarian', 'Български', 'cyrillic', 'ltr'],
        ['bn', 'Bengali', 'বাংলা', 'bengali', 'ltr'],
        ['cs', 'Czech', 'Čeština', 'latin', 'ltr'],
        ['da', 'Danish', 'Dansk', 'latin', 'ltr'],
        ['de', 'German', 'Deutsch', 'latin', 'ltr'],
        ['el', 'Greek', 'Ελληνικά', 'greek', 'ltr'],
        ['es', 'Spanish', 'Español', 'latin', 'ltr'],
        ['fa', 'Persian', 'فارسی', 'persian', 'rtl'],
        ['fi', 'Finnish', 'Suomi', 'latin', 'ltr'],
        ['fil', 'Filipino', 'Filipino', 'latin', 'ltr'],
        ['fr', 'French', 'Français', 'latin', 'ltr'],
        ['he', 'Hebrew', 'עברית', 'hebrew', 'rtl'],
        ['hi', 'Hindi', 'हिन्दी', 'devanagari', 'ltr'],
        ['hr', 'Croatian', 'Hrvatski', 'latin', 'ltr'],
        ['hu', 'Hungarian', 'Magyar', 'latin', 'ltr'],
        ['id', 'Indonesian', 'Bahasa Indonesia', 'latin', 'ltr'],
        ['it', 'Italian', 'Italiano', 'latin', 'ltr'],
        ['ja', 'Japanese', '日本語', 'japanese', 'ltr'],
        ['ko', 'Korean', '한국어', 'korean', 'ltr'],
        ['mr', 'Marathi', 'मराठी', 'devanagari', 'ltr'],
        ['ms', 'Malay', 'Bahasa Melayu', 'latin', 'ltr'],
        ['nb', 'Norwegian', 'Norsk bokmål', 'latin', 'ltr'],
        ['nl', 'Dutch', 'Nederlands', 'latin', 'ltr'],
        ['pl', 'Polish', 'Polski', 'latin', 'ltr'],
        ['pt-BR', 'Portuguese', 'Português (Brasil)', 'latin', 'ltr'],
        ['ro', 'Romanian', 'Română', 'latin', 'ltr'],
        ['ru', 'Russian', 'Русский', 'cyrillic', 'ltr'],
        ['sk', 'Slovak', 'Slovenčina', 'latin', 'ltr'],
        ['sv', 'Swedish', 'Svenska', 'latin', 'ltr'],
        ['sw', 'Swahili', 'Kiswahili', 'latin', 'ltr'],
        ['ta', 'Tamil', 'தமிழ்', 'tamil', 'ltr'],
        ['te', 'Telugu', 'తెలుగు', 'telugu', 'ltr'],
        ['th', 'Thai', 'ไทย', 'thai', 'ltr'],
        ['tr', 'Turkish', 'Türkçe', 'latin', 'ltr'],
        ['uk', 'Ukrainian', 'Українська', 'cyrillic', 'ltr'],
        ['ur', 'Urdu', 'اردو', 'urdu', 'rtl'],
        ['vi', 'Vietnamese', 'Tiếng Việt', 'latin', 'ltr'],
        ['zh-CN', 'Chinese (Simplified)', '简体中文', 'han-sc', 'ltr'],
        ['zh-TW', 'Chinese (Traditional)', '繁體中文', 'han-tc', 'ltr']
    ].map(([code, name, nativeName, script, dir]) => ({ code, name, nativeName, script, dir }));

    const BY_CODE = new Map(LANGUAGES.map((language) => [language.code.toLowerCase(), language]));

    // Turn any BCP 47 tag (en-GB, pt, zh-Hant-HK, iw, no) into a shipped code, or null.
    function matchLanguage(tag) {
        if (typeof tag !== 'string' || !tag.trim()) return null;
        const lower = tag.trim().replace(/_/g, '-').toLowerCase();
        if (BY_CODE.has(lower)) return BY_CODE.get(lower).code;
        const [base, ...rest] = lower.split('-');
        if (base === 'zh') {
            const traditional = rest.some((part) => ['hant', 'tw', 'hk', 'mo'].includes(part));
            return traditional ? 'zh-TW' : 'zh-CN';
        }
        const aliases = { pt: 'pt-BR', no: 'nb', nn: 'nb', iw: 'he', in: 'id', tl: 'fil', fil: 'fil', zsm: 'ms' };
        if (aliases[base]) return aliases[base];
        return BY_CODE.has(base) ? BY_CODE.get(base).code : null;
    }

    // The first language in the list we ship, so "en-US, ar" stays English.
    function matchFirstLanguage(tags) {
        for (const tag of tags || []) {
            const match = matchLanguage(tag);
            if (match) return match;
        }
        return null;
    }

    function getLanguage(code) {
        return BY_CODE.get(String(code || '').toLowerCase()) || BY_CODE.get('en');
    }

    const api = { LANGUAGES, matchLanguage, matchFirstLanguage, getLanguage };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.GVL_LANGUAGES = api;
})(typeof self !== 'undefined' ? self : this);
