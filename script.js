// script.js - Frontend logic for GetVideosLocally

// Saved preferences are mirrored to a file in AppData. If this window starts
// with empty storage (for example the app had to use a different local port),
// put them back before anything reads them.
const SETTINGS_BACKUP_KEYS = ['ytdUserSettings', 'downloadFolder', 'ytdTutorialCompleted', 'gvl_lastSeenVersion'];
(function restoreSettingsBackup() {
    try {
        if (localStorage.getItem('ytdUserSettings') !== null) return;
        const snapshot = window.electronAPI?.readSettingsBackup?.();
        if (!snapshot || typeof snapshot !== 'object') return;
        for (const key of SETTINGS_BACKUP_KEYS) {
            if (typeof snapshot[key] === 'string' && localStorage.getItem(key) === null) {
                localStorage.setItem(key, snapshot[key]);
            }
        }
    } catch (error) {
        console.warn('Unable to restore saved settings backup:', error);
    }
})();

// Move these to global scope (before DOMContentLoaded)
let ws;
let clientId = localStorage.getItem('ytdClientId');
let activeDownloader = localStorage.getItem('activeDownloader') || 'youtube';
if (!['youtube', 'history'].includes(activeDownloader)) {
    activeDownloader = 'youtube';
    localStorage.setItem('activeDownloader', activeDownloader);
}
let userSettings;
let downloadItemsState;
let isPowerSaveBlockerActive = false;
const SUPPORT_POPUP_LAST_VERSION_KEY = 'gvl_supportPopupLastShownVersion';
const SUPPORT_DONATION_URL = 'https://donate.stripe.com/6oU00i73R6eh2yc0oU5AQ00';
const LOCAL_THUMBNAIL_PLACEHOLDER = '/assets/thumbnail-placeholder.svg';
const SETUP_HEALTH_RUN_KEY = 'gvlSetupHealthHasRun';
const HTML_ESCAPE_MAP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
};

function escapeHtml(rawValue) {
    return String(rawValue ?? '').replace(/[&<>"']/g, char => HTML_ESCAPE_MAP[char]);
}

// Server payloads carry the English text plus an optional translation key.
// t() of an unknown English string returns it unchanged, so raw tool errors
// (yt-dlp, ffmpeg) still show as they came.
function serverText(data, fallback) {
    if (data && data.messageKey) return t(data.messageKey, data.messageVars);
    if (data && data.message) return t(data.message);
    return fallback ?? '';
}

function serverError(data, fallback) {
    if (data && data.errorKey) return t(data.errorKey, data.errorVars);
    if (data && data.error) return t(String(data.error));
    return fallback ?? '';
}

// Same for a 'reason' field (uiMessage(key, vars, 'reason') on the server).
function serverReason(data, fallback) {
    if (data && data.reasonKey) return t(data.reasonKey, data.reasonVars);
    if (data && data.reason) return t(String(data.reason));
    return fallback ?? '';
}

function normalizeDownloadFolderPath(folderPath) {
    return typeof folderPath === 'string' ? folderPath.trim() : '';
}

function getPersistedDownloadFolder() {
    const settingsFolder = normalizeDownloadFolderPath(userSettings?.downloadFolder);
    if (settingsFolder) return settingsFolder;

    try {
        const storedSettings = JSON.parse(localStorage.getItem('ytdUserSettings') || '{}');
        const storedSettingsFolder = normalizeDownloadFolderPath(storedSettings.downloadFolder);
        if (storedSettingsFolder) return storedSettingsFolder;
    } catch (error) {
        console.warn('Unable to read the saved download folder from Settings:', error);
    }

    return normalizeDownloadFolderPath(localStorage.getItem('downloadFolder'));
}

// Settings live in localStorage, which Chromium writes to disk lazily. Ask the
// desktop shell to flush shortly after any change so a crash, a forced close
// during an update or a Windows shutdown cannot roll preferences back.
let settingsFlushTimer = null;
function flushSettingsToDisk() {
    if (!window.electronAPI || typeof window.electronAPI.flushStorageData !== 'function') return;
    clearTimeout(settingsFlushTimer);
    settingsFlushTimer = setTimeout(() => {
        window.electronAPI.flushStorageData().catch(() => {});
        if (typeof window.electronAPI.writeSettingsBackup === 'function') {
            const snapshot = {};
            for (const key of SETTINGS_BACKUP_KEYS) {
                const value = localStorage.getItem(key);
                if (value !== null) snapshot[key] = value;
            }
            window.electronAPI.writeSettingsBackup(snapshot).catch(() => {});
        }
    }, 250);
}

function saveUserSettingsToStorage(settings = userSettings) {
    localStorage.setItem('ytdUserSettings', JSON.stringify(settings));
    flushSettingsToDisk();
}

function persistDownloadFolderPath(folderPath) {
    const normalizedFolderPath = normalizeDownloadFolderPath(folderPath);
    userSettings = {
        ...(userSettings || {}),
        downloadFolder: normalizedFolderPath
    };

    saveUserSettingsToStorage();
    if (normalizedFolderPath) {
        localStorage.setItem('downloadFolder', normalizedFolderPath);
    } else {
        localStorage.removeItem('downloadFolder');
    }
    window.userSettings = userSettings;

    const settingsFolderInput = document.getElementById('downloadFolder');
    if (settingsFolderInput) settingsFolderInput.value = normalizedFolderPath;

    return normalizedFolderPath;
}

// Make WebSocket globally accessible
window.ws = ws;

document.addEventListener('DOMContentLoaded', () => {
    // Initialize variables
    if (!clientId) {
        clientId = `client_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        localStorage.setItem('ytdClientId', clientId);
    }
    userSettings = loadSettings();
    // Tell the desktop shell which language the window uses (tray menu, dialogs).
    window.electronAPI?.setUiLanguage?.(t.lang);
    downloadItemsState = new Map(); // To store item details and manage them
    const downloadDismissals = window.createDownloadDismissals({
        storage: localStorage,
        clientId,
        removeRemote: async (itemId) => {
            const response = await window.localApiAuth.authorizedFetch(`/download-items/${encodeURIComponent(itemId)}?clientId=${encodeURIComponent(clientId)}`, { method: 'DELETE' });
            if (!response.ok) throw new Error(`Removal failed with ${response.status}`);
        }
    });
    const dismissedDownloadItems = downloadDismissals.dismissed;
    let removalRetryTimer;
    window.__GVL_ACTIVE_DOWNLOAD_COUNT = 0;

    // Initialize error telemetry (opt-in, privacy-respectful)
    (function () {
        const telemetry = {
            enabled: false,
            anonymousId: (() => {
                const key = 'simplyytd_anonymous_id';
                let id = localStorage.getItem(key);
                if (!id) {
                    id = `anon_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
                    localStorage.setItem(key, id);
                }
                return id;
            })(),
            errorQueue: [],
            maxQueueSize: 100,

            enable() {
                this.enabled = true;
                this.setupErrorHandlers();
                console.log('✅ Error telemetry enabled (opt-in)');
            },

            disable() {
                this.enabled = false;
            },

            setupErrorHandlers() {
                window.addEventListener('error', (event) => {
                    if (!this.enabled) return;
                    this.captureError({
                        message: (event.message || '').substring(0, 200),
                        filename: event.filename ? event.filename.split(/[\\/]/).pop() : undefined,
                        lineno: event.lineno,
                        type: 'unhandled_error'
                    });
                });

                window.addEventListener('unhandledrejection', (event) => {
                    if (!this.enabled) return;
                    this.captureError({
                        message: (event.reason?.message || String(event.reason)).substring(0, 200),
                        type: 'unhandled_promise_rejection'
                    });
                });
            },

            captureError(errorInfo) {
                if (!this.enabled) return;
                const telemetryData = {
                    anonymousId: this.anonymousId,
                    timestamp: new Date().toISOString(),
                    error: errorInfo
                };
                this.errorQueue.push(telemetryData);
                if (this.errorQueue.length > this.maxQueueSize) {
                    this.errorQueue.shift();
                }
                // Note: Actual sending would require a configured endpoint
                // For now, errors are queued but not sent unless endpoint is configured
            }
        };

        window.GetVideosLocallyTelemetry = telemetry;
        if (userSettings.errorTelemetry) {
            telemetry.enable();
        }
    })();

    // Local-only record of UI errors for the diagnostics bundle. Never sent
    // anywhere unless the user generates and shares a bundle.
    const diagnosticsErrorLog = [];
    function recordDiagnosticsError(type, message, source) {
        diagnosticsErrorLog.push({
            time: new Date().toISOString(),
            type,
            message: String(message || '').substring(0, 500),
            source,
        });
        if (diagnosticsErrorLog.length > 50) diagnosticsErrorLog.shift();
    }
    window.addEventListener('error', (event) => {
        const file = event.filename ? event.filename.split(/[\\/]/).pop() : '';
        recordDiagnosticsError('error', event.error?.stack || event.message,
            file ? `${file}:${event.lineno}:${event.colno}` : undefined);
    });
    window.addEventListener('unhandledrejection', (event) => {
        recordDiagnosticsError('unhandledrejection', event.reason?.stack || event.reason?.message || String(event.reason));
    });

    // Make userSettings globally accessible
    window.userSettings = userSettings;
    window.managePowerSaveBlocker = managePowerSaveBlocker;
    window.isPowerSaveBlockerActive = isPowerSaveBlockerActive;

    // DOM Elements - These might not all exist on every page
    const youtubeUrlInput = document.getElementById('youtubeUrl');
    const formatSelect = document.getElementById('format');
    const qualitySelect = document.getElementById('quality'); // For YouTube
    const playlistOptionsDiv = document.getElementById('playlistOptions');
    const playlistActionSelect = document.getElementById('playlistAction');
    const playlistConcurrencySelect = document.getElementById('concurrency');
    const advancedDownloadOptions = document.getElementById('advancedDownloadOptions');
    const hdrModeOverrideSelect = document.getElementById('hdrModeOverride');
    const scheduleDownloadToggle = document.getElementById('scheduleDownloadToggle');
    const scheduleDownloadAt = document.getElementById('scheduleDownloadAt');
    const startYoutubeDownloadBtn = document.getElementById('startYoutubeDownloadBtn');
    const youtubeStatusDiv = document.getElementById('status');
    const failureHelpPanel = document.getElementById('failureHelpPanel');
    const failureHelpTitle = document.getElementById('failureHelpTitle');
    const failureHelpEyebrow = document.getElementById('failureHelpEyebrow');
    const failureHelpDescription = document.getElementById('failureHelpDescription');
    const failureHelpSteps = document.getElementById('failureHelpSteps');
    const failureHelpActions = document.getElementById('failureHelpActions');
    const failureHelpPrimaryBtn = document.getElementById('failureHelpPrimaryBtn');
    const dismissFailureHelpBtn = document.getElementById('dismissFailureHelpBtn');
    const youtubeDownloadLinksArea = document.getElementById('downloadLinksArea');
    const emptyDownloadState = document.getElementById('emptyDownloadState');
    const clearYoutubeDownloadsBtn = document.getElementById('clearYoutubeDownloadsBtn');

    if (emptyDownloadState) emptyDownloadState.style.display = 'flex';
    if (clearYoutubeDownloadsBtn) clearYoutubeDownloadsBtn.style.display = 'none';
    const networkBanner = document.getElementById('networkBanner');
    const appLiveRegion = document.getElementById('appLiveRegion');

    const youtubeTab = document.getElementById('youtubeTab');
    const contactUsTab = document.querySelector('nav.main-nav a[href="contact.html"]');
    const historyTab = document.getElementById('historyTab');

    const settingsBtn = document.getElementById('settingsBtn');
    const settingsModal = document.getElementById('settingsModal');
    const closeSettingsBtn = document.getElementById('closeSettingsBtn');
    const saveSettingsBtn = document.getElementById('saveSettingsBtn');
    const setupHealthSection = document.getElementById('setupHealthSection');
    const setupHealthSummary = document.getElementById('setupHealthSummary');
    const setupHealthTimestamp = document.getElementById('setupHealthTimestamp');
    const setupHealthList = document.getElementById('setupHealthList');
    const runHealthCheckBtn = document.getElementById('runHealthCheckBtn');
    const toggleHealthCheckBtn = document.getElementById('toggleHealthCheckBtn');
    const supportModal = document.getElementById('supportModal');
    const closeSupportModalBtn = document.getElementById('closeSupportModalBtn');
    const supportModalDonateBtn = document.getElementById('supportModalDonateBtn');
    const supportModalDismissBtn = document.getElementById('supportModalDismissBtn');
    const supportModalNeverBtn = document.getElementById('supportModalNeverBtn');
    const playlistSelectionModal = document.getElementById('playlistSelectionModal');
    const closePlaylistSelectionBtn = document.getElementById('closePlaylistSelectionBtn');
    const playlistSelectionSummary = document.getElementById('playlistSelectionSummary');
    const playlistSelectionList = document.getElementById('playlistSelectionList');
    const playlistSelectAllBtn = document.getElementById('playlistSelectAllBtn');
    const playlistSelectionCount = document.getElementById('playlistSelectionCount');
    const confirmPlaylistSelectionBtn = document.getElementById('confirmPlaylistSelectionBtn');
    const cancelPlaylistSelectionBtn = document.getElementById('cancelPlaylistSelectionBtn');

    const maxSpeedInput = document.getElementById('maxSpeed');
    const numerateFilesCheckbox = document.getElementById('numerateFiles');
    const skipDuplicatesCheckbox = document.getElementById('skipDuplicates');
    const rememberDownloadChoicesCheckbox = document.getElementById('rememberDownloadChoices');
    const removeCompletedCheckbox = document.getElementById('removeCompleted');
    const notificationSoundCheckbox = document.getElementById('notificationSound');
    const notificationPopupCheckbox = document.getElementById('notificationPopup');
    const keepPcAwakeCheckbox = document.getElementById('keepPcAwake');
    const preferHdrCheckbox = document.getElementById('preferHdr');
    const subtitleModeSelect = document.getElementById('subtitleMode');
    const subtitleLanguagesInput = document.getElementById('subtitleLanguages');
    const includeAutoCaptionsCheckbox = document.getElementById('includeAutoCaptions');
    const speedUnitDisplaySelect = document.getElementById('speedUnitDisplay');
    const resetSpeedBtn = document.getElementById('resetSpeedBtn');
    const downloadFolderInput = document.getElementById('downloadFolder');
    const chooseFolderBtn = document.getElementById('chooseFolderBtn');
    const defaultFolderBtn = document.getElementById('defaultFolderBtn');
    const openFolderBtn = document.getElementById('openFolderBtn');
    const skipDeleteConfirmationCheckbox = document.getElementById('skipDeleteConfirmation');
    const themePresetSelect = document.getElementById('themePreset');

    const completionSound = document.getElementById('completionSound');

    const pasteYoutubeUrlBtn = document.getElementById('pasteYoutubeUrlBtn');
    let failureHelpActionHandler = null;
    let latestSetupHealthResult = null;
    let lastRateLimitNoticeAt = 0;
    const previewInfoCache = new Map();
    const pendingPreviewRequests = new Map();
    const PREVIEW_INFO_CACHE_TTL = 5 * 60 * 1000;
    let pendingPlaylistSelectionRequest = null;

    const importCookiesBtn = document.getElementById('importCookiesBtn');
    if (importCookiesBtn) {
        importCookiesBtn.onclick = () => {
            if (window.electronAPI && window.electronAPI.openCookiesHelper) {
                window.electronAPI.openCookiesHelper();
            } else {
                window.open('public/cookies.html', 'ImportCookies', 'width=600,height=500');
            }
        };
    }

    function getDownloadFolder() {
        return getPersistedDownloadFolder();
    }

    function setElementHiddenState(element, hidden) {
        if (!element) return;
        element.classList.toggle('is-hidden-initial', hidden);
    }

    function setSetupHealthSectionVisibility(visible) {
        if (!setupHealthSection) return;
        setElementHiddenState(setupHealthSection, !visible);
        setupHealthSection.hidden = !visible;
        setupHealthSection.style.display = visible ? 'flex' : 'none';
        if (toggleHealthCheckBtn) {
            toggleHealthCheckBtn.checked = visible;
        }
    }

    function announceLiveMessage(message) {
        if (!appLiveRegion || !message) return;
        appLiveRegion.textContent = '';
        window.clearTimeout(announceLiveMessage._timer);
        announceLiveMessage._timer = window.setTimeout(() => {
            appLiveRegion.textContent = message;
        }, 20);
    }

    function makeElementKeyboardClickable(element, onActivate, label) {
        if (!element || typeof onActivate !== 'function') return;
        element.setAttribute('role', 'button');
        element.setAttribute('tabindex', '0');
        if (label) {
            element.setAttribute('aria-label', label);
        }
        element.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onActivate(event);
            }
        });
    }

    // Visual state, short label and icon for the status pill under Download Now.
    const STATUS_PILL_STATES = {
        success: { label: t('Ready'), icon: 'fa-check' },
        info: { label: t('Working'), icon: 'fa-arrow-down' },
        warning: { label: t('Heads up'), icon: 'fa-triangle-exclamation' },
        error: { label: t('Issue'), icon: 'fa-exclamation' },
        cancelled: { label: t('Cancelled'), icon: 'fa-xmark', state: 'error' },
        connecting: { label: t('Reconnecting'), icon: 'fa-tower-broadcast' },
        offline: { label: t('Offline'), icon: 'fa-plug-circle-xmark', state: 'error' },
        updating: { label: t('Updating'), icon: 'fa-arrows-rotate', state: 'info' }
    };

    // Messages sit on top of the connection state briefly, then the pill falls back to it.
    const STATUS_PILL_SHORT_MS = 4000;
    const STATUS_PILL_MAX_MS = 7000;
    let serverConnection = 'starting'; // 'starting' | 'ready' | 'reconnecting'
    let statusPillTimer = null;
    // Mirrors the server's tool update gate: 'idle' | 'waiting' | 'installing'.
    let toolUpdateState = { phase: 'idle', tool: null, activeCount: 0, waitingCount: 0 };

    function getToolUpdateStatus() {
        const { phase, tool, activeCount, waitingCount } = toolUpdateState;
        const name = tool || t('tools');
        if (phase === 'waiting' && activeCount > 0) {
            const installs = t.plural(activeCount, '{tool} update installs after {count} download finishes', '{tool} update installs after {count} downloads finish', { tool: name });
            const message = waitingCount > 0
                ? t('{update}; {queue}', {
                    update: installs,
                    queue: t.plural(waitingCount, '{count} download waits for it', '{count} downloads wait for it')
                })
                : installs;
            return { message, type: 'updating', label: t('Update waiting'), wave: 'ready' };
        }
        if (phase === 'waiting' || phase === 'installing') {
            return { message: t('Installing {tool} update. Downloads resume right after', { tool: name }), type: 'updating', label: t('Updating'), wave: 'ready' };
        }
        return null;
    }

    function getConnectionStatus() {
        if (serverConnection === 'starting') {
            return { message: t('Connecting to server'), type: 'connecting', label: t('Starting up'), wave: 'connecting' };
        }
        if (serverConnection === 'reconnecting') {
            return { message: t('Server disconnected'), type: 'connecting', label: t('Reconnecting'), wave: 'connecting' };
        }
        if (navigator.onLine === false) {
            return { message: t("You're offline. Reconnect to download"), type: 'offline', label: t('Offline'), wave: 'offline' };
        }
        return getToolUpdateStatus() ||
            { message: t('Connected to server'), type: 'success', label: t('Ready'), wave: 'ready', idle: true };
    }

    function setToolUpdateState(next) {
        const wasIdle = toolUpdateState.phase === 'idle';
        toolUpdateState = { ...toolUpdateState, ...next };
        if (wasIdle && toolUpdateState.phase === 'idle') return;
        // Leave a timed message up; the pill falls back to this state after it.
        if (!statusPillTimer) showConnectionStatus({ announce: wasIdle || toolUpdateState.phase === 'idle' });
    }

    function renderStatusPill(message, type, label, idle = false) {
        const statusDiv = youtubeStatusDiv;
        if (!statusDiv) return;
        const stateKey = STATUS_PILL_STATES[type] ? type : 'info';
        const config = STATUS_PILL_STATES[stateKey];
        const title = String(message || '').trim().replace(/([^.])\.$/, '$1');
        statusDiv.className = `status-pill is-${config.state || stateKey}${idle ? ' is-idle' : ''}`;
        statusDiv.dataset.connection = getConnectionStatus().wave;
        statusDiv.title = title;
        const icon = statusDiv.querySelector('.status-pill-icon i');
        const titleEl = statusDiv.querySelector('.status-pill-title');
        const labelEl = statusDiv.querySelector('.status-pill-label');
        if (icon) icon.className = `fas ${config.icon}`;
        if (titleEl) titleEl.textContent = title;
        if (labelEl) labelEl.textContent = label || config.label;
        // Restart the entrance animation for every new message.
        void statusDiv.offsetWidth;
        statusDiv.classList.add('is-entering');
    }

    function showConnectionStatus(options = {}) {
        window.clearTimeout(statusPillTimer);
        statusPillTimer = null;
        const status = getConnectionStatus();
        renderStatusPill(status.message, status.type, status.label, status.idle);
        if (options.announce) announceLiveMessage(status.message);
    }

    function setServerConnection(next) {
        if (serverConnection === next) return;
        serverConnection = next;
        // A running message finishes its time unless the connection just got worse.
        if (statusPillTimer && next === 'ready') {
            if (youtubeStatusDiv) youtubeStatusDiv.dataset.connection = getConnectionStatus().wave;
            return;
        }
        showConnectionStatus({ announce: true });
    }

    function showStatus(message, downloaderSource, type = 'info', label) {
        void downloaderSource;
        renderStatusPill(message, type, label);
        window.clearTimeout(statusPillTimer);
        const duration = type === 'success' || type === 'info' ? STATUS_PILL_SHORT_MS : STATUS_PILL_MAX_MS;
        statusPillTimer = window.setTimeout(() => showConnectionStatus(), duration);
        announceLiveMessage(message);
    }

    function updateNetworkUI(options = {}) {
        const isOffline = navigator.onLine === false;
        const shouldAnnounce = options.announce === true;

        if (networkBanner) {
            networkBanner.hidden = !isOffline;
        }

        if (startYoutubeDownloadBtn) {
            startYoutubeDownloadBtn.disabled = isOffline;
            startYoutubeDownloadBtn.setAttribute('aria-disabled', String(isOffline));
            startYoutubeDownloadBtn.title = isOffline
                ? t('Reconnect to start downloads')
                : t('Start download');
        }

        if (isOffline) {
            showConnectionStatus({ announce: shouldAnnounce });
            return;
        }

        if (shouldAnnounce) {
            showStatus(t('Connection restored. Downloads are available again.'), 'youtube', 'success', t('Back online'));
        }
    }

    function normalizePreviewUrl(url) {
        return typeof url === 'string' ? url.trim() : '';
    }

    function isPreviewableUrl(url) {
        return /^https?:\/\/.+/i.test(url);
    }

    function isLikelyPlaylistUrl(url) {
        return url.includes('list=') || url.includes('/playlist') || url.includes('/videos') || url.includes('/channel/') || url.includes('/user/');
    }

    function getCachedPreviewInfo(url) {
        const normalizedUrl = normalizePreviewUrl(url);
        const cachedEntry = previewInfoCache.get(normalizedUrl);
        if (!cachedEntry) {
            return null;
        }

        if (Date.now() - cachedEntry.timestamp >= PREVIEW_INFO_CACHE_TTL) {
            previewInfoCache.delete(normalizedUrl);
            return null;
        }

        return cachedEntry.data;
    }

    function setCachedPreviewInfo(url, previewInfo) {
        const normalizedUrl = normalizePreviewUrl(url);
        if (!normalizedUrl || !previewInfo) {
            return;
        }

        previewInfoCache.set(normalizedUrl, {
            data: previewInfo,
            timestamp: Date.now()
        });
    }

    function scheduleYoutubePreview(options = {}) {
        if (!youtubeUrlInput) {
            return;
        }

        const { immediate = false, showErrors = false, forceRefresh = false } = options;
        const normalizedUrl = normalizePreviewUrl(youtubeUrlInput.value);

        window.clearTimeout(scheduleYoutubePreview._timer);
        if (!normalizedUrl || !isPreviewableUrl(normalizedUrl) || isLikelyPlaylistUrl(normalizedUrl) || navigator.onLine === false) {
            return;
        }

        if (!forceRefresh && getCachedPreviewInfo(normalizedUrl)) {
            return;
        }

        const runPreviewFetch = () => {
            fetchVideoInfo(normalizedUrl, 'youtube', {
                showErrors,
                forceRefresh
            }).catch((error) => {
                console.warn('Preview fetch failed:', error);
            });
        };

        if (immediate) {
            runPreviewFetch();
            return;
        }

        scheduleYoutubePreview._timer = window.setTimeout(runPreviewFetch, 350);
    }

    function isPotentialRateLimitMessage(message) {
        const normalizedMessage = String(message || '').toLowerCase();
        return normalizedMessage.includes('rate limiting detected')
            || normalizedMessage.includes('rate-limited')
            || normalizedMessage.includes('too many requests')
            || normalizedMessage.includes('429');
    }

    function showPotentialRateLimitNotice(message) {
        const warningMessage = message || t('Potential rate limiting detected. The app is slowing requests to avoid restrictions. Wait a bit before retrying repeatedly.');
        showStatus(warningMessage, 'youtube', 'warning');

        const now = Date.now();
        if (now - lastRateLimitNoticeAt < 15000) {
            return;
        }

        lastRateLimitNoticeAt = now;
        showNotification(t('Potential rate limiting detected. Downloads may start more slowly for a short time.'), 'warning');
    }

    function openSettingsWithSection(sectionElement) {
        populateSettingsModal();
        if (sectionElement) {
            activateSettingsTab(sectionElement.closest('[data-settings-panel]')?.dataset.settingsPanel);
        }
        if (sectionElement) {
            if (sectionElement === setupHealthSection) {
                setSetupHealthSectionVisibility(true);
            } else {
                setElementHiddenState(sectionElement, false);
            }
        }
        if (settingsModal) {
            openModalWithFocus(settingsModal, closeSettingsBtn || saveSettingsBtn);
        }
        if (sectionElement) {
            window.setTimeout(() => {
                sectionElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 60);
        }
    }

    // ===== LOGIN COOKIE HEALTH =====
    const cookiesStatusDesc = document.getElementById('cookiesStatusDesc');
    const COOKIE_WARNING_DISMISSED_KEY = 'gvl.cookieWarningDismissed';
    const COOKIE_DEFAULT_DESC = t('Import cookies to download age-restricted or members-only videos');
    let cookieHealth = null;
    let cookieHealthCheckedAt = 0;

    function formatCookieDate(timestamp) {
        return t.formatDate(new Date(timestamp), { day: 'numeric', month: 'short', year: 'numeric' });
    }

    // How long until the login runs out: 'soon' (within the hour), hours or days.
    function getCookieCountdown(timestamp) {
        const hours = Math.round((timestamp - Date.now()) / 3600000);
        if (hours <= 1) return { unit: 'soon', count: 0 };
        if (hours < 36) return { unit: 'hours', count: hours };
        return { unit: 'days', count: Math.round(hours / 24) };
    }

    function describeCookieHealth(health) {
        switch (health?.status) {
            case 'valid':
                return { text: t('Signed in to YouTube. Login lasts until {date}', { date: formatCookieDate(health.expiresAt) }), tone: 'ok' };
            case 'expiring': {
                const left = getCookieCountdown(health.expiresAt);
                const text = left.unit === 'soon'
                    ? t('YouTube login expires within the hour. Import fresh cookies to keep signed-in downloads working')
                    : left.unit === 'hours'
                        ? t.plural(left.count, 'YouTube login expires in {count} hour. Import fresh cookies to keep signed-in downloads working', 'YouTube login expires in {count} hours. Import fresh cookies to keep signed-in downloads working')
                        : t.plural(left.count, 'YouTube login expires in {count} day. Import fresh cookies to keep signed-in downloads working', 'YouTube login expires in {count} days. Import fresh cookies to keep signed-in downloads working');
                return { text, tone: 'warn' };
            }
            case 'expired':
                return { text: t('YouTube login expired on {date}. Import fresh cookies', { date: formatCookieDate(health.expiresAt) }), tone: 'bad' };
            case 'session':
                return { text: t('Imported a browser-session login, which YouTube ends when that browser closes. Import again if downloads ask you to sign in'), tone: 'warn' };
            case 'no-login':
                return { text: t('Cookies imported, but no YouTube sign-in was found in them. Export again while signed in'), tone: 'warn' };
            case 'invalid':
                return { text: t("The imported cookies file can't be read. Import it again"), tone: 'bad' };
            default:
                return { text: COOKIE_DEFAULT_DESC, tone: 'none' };
        }
    }

    function cookieWarningKey(health) {
        return `${health.status}:${health.expiresAt || ''}`;
    }

    function rememberCookieWarningDismissed() {
        if (cookieHealth) localStorage.setItem(COOKIE_WARNING_DISMISSED_KEY, cookieWarningKey(cookieHealth));
    }

    function showCookieExpiryHelp(health) {
        const expired = health.status === 'expired';
        let title = t('Your YouTube login has expired.');
        if (!expired) {
            const left = getCookieCountdown(health.expiresAt);
            title = left.unit === 'soon'
                ? t('Your YouTube login expires within the hour.')
                : left.unit === 'hours'
                    ? t.plural(left.count, 'Your YouTube login expires in {count} hour.', 'Your YouTube login expires in {count} hours.')
                    : t.plural(left.count, 'Your YouTube login expires in {count} day.', 'Your YouTube login expires in {count} days.');
        }
        renderHelpPanel({
            title,
            description: expired
                ? t('Downloads that need a signed-in account (age-restricted, members-only, private) will fail until you import fresh cookies.')
                : t('Import fresh cookies now so age-restricted and members-only downloads keep working.'),
            steps: [
                t('Open YouTube in your browser and make sure you are signed in.'),
                t('Export cookies with the helper and import them here.')
            ],
            actionLabel: t('Import fresh cookies'),
            action: () => openCookiesHelperFlow()
        }, t('Sign-in cookies'), 'cookies');
    }

    async function refreshCookieHealth({ warn = false } = {}) {
        if (!window.localApiAuth?.authorizedFetch) return null;
        try {
            const response = await window.localApiAuth.authorizedFetch('/cookies-status');
            if (!response.ok) return null;
            cookieHealth = await response.json();
            cookieHealthCheckedAt = Date.now();
        } catch (error) {
            console.warn('Could not read cookie status:', error);
            return null;
        }

        const { text, tone } = describeCookieHealth(cookieHealth);
        if (cookiesStatusDesc) {
            cookiesStatusDesc.textContent = text;
            cookiesStatusDesc.dataset.tone = tone;
        }
        if (importCookiesBtn) {
            const needsFresh = tone === 'warn' || tone === 'bad';
            importCookiesBtn.innerHTML = `<i class="fas fa-cookie-bite"></i> ${escapeHtml(needsFresh ? t('Import fresh') : t('Import'))}`;
        }

        const needsWarning = cookieHealth.status === 'expiring' || cookieHealth.status === 'expired';
        if (needsWarning && warn && localStorage.getItem(COOKIE_WARNING_DISMISSED_KEY) !== cookieWarningKey(cookieHealth)) {
            showCookieExpiryHelp(cookieHealth);
        } else if (!needsWarning && failureHelpKind === 'cookies') {
            // Fresh cookies were imported; the warning has done its job.
            failureHelpKind = null;
            hideFailureHelp();
        }
        return cookieHealth;
    }

    // Re-check when the window regains focus, e.g. after the cookie helper closes.
    window.addEventListener('focus', () => {
        if (Date.now() - cookieHealthCheckedAt > 10000) void refreshCookieHealth({ warn: true });
    });
    window.setInterval(() => void refreshCookieHealth({ warn: true }), 6 * 60 * 60 * 1000);

    async function openCookiesHelperFlow() {
        if (window.electronAPI && window.electronAPI.openCookiesHelper) {
            await window.electronAPI.openCookiesHelper();
            return;
        }
        window.open('public/cookies.html', 'ImportCookies', 'width=600,height=500');
    }

    async function getSavedCookiesInfo() {
        if (!window.electronAPI || !window.electronAPI.getCookiesTxt) {
            return {
                available: false,
                hasCookies: false,
                content: '',
                path: ''
            };
        }

        try {
            const result = await window.electronAPI.getCookiesTxt();
            const content = String(result?.content || '').trim();
            return {
                available: true,
                hasCookies: Boolean(result?.success && content.length > 50),
                content,
                path: result?.path || ''
            };
        } catch (error) {
            console.error('Unable to read saved cookies:', error);
            return {
                available: true,
                hasCookies: false,
                content: '',
                path: ''
            };
        }
    }

    async function openConfiguredDownloadFolder() {
        const folderPath = getDownloadFolder() || downloadFolderInput?.value || localStorage.getItem('downloadFolder') || '';
        if (!folderPath) {
            showAlert(t('No download folder is configured yet.'), t('Download Folder'));
            return;
        }
        if (window.electronAPI && window.electronAPI.openPathInExplorer) {
            const result = await window.electronAPI.openPathInExplorer(folderPath, folderPath);
            if (!result?.success) {
                showAlert(t('Unable to open this folder: {error}', { error: serverError(result, t('Unknown error')) }), t('Open Folder Failed'));
            }
            return;
        }
        showAlert(t('Open folder is only available in the desktop app.'), t('Not Available'));
    }

    function hideFailureHelp({ dismissed = false } = {}) {
        // Download activity clears failure help but leaves the login warning up.
        if (failureHelpKind === 'cookies') {
            if (!dismissed) return;
            rememberCookieWarningDismissed();
        }
        failureHelpKind = null;
        setElementHiddenState(failureHelpPanel, true);
        if (failureHelpTitle) {
            failureHelpTitle.textContent = t('We found a likely cause');
        }
        if (failureHelpDescription) {
            failureHelpDescription.textContent = '';
        }
        if (failureHelpSteps) {
            failureHelpSteps.innerHTML = '';
        }
        if (failureHelpPrimaryBtn) {
            failureHelpPrimaryBtn.textContent = '';
        }
        failureHelpActionHandler = null;
        setElementHiddenState(failureHelpActions, true);
    }

    function buildFailureHelpConfig(errorMessage) {
        // Unit tests load this function on its own, without the i18n runtime.
        const tr = typeof t === 'function' ? t : (text, vars) => String(text).replace(/\{(\w+)\}/g, (match, name) => (vars && name in vars ? String(vars[name]) : match));
        // Match the English error text; the panel content is what gets translated.
        const normalizedMessage = String(errorMessage || '').toLowerCase();

        const configs = [
            {
                id: 'cookies_rejected',
                pattern: /(saved cookie session was rejected|imported cookies appear to be expired|provided youtube account cookies are no longer valid|authentication failed despite cookies)/i,
                title: tr('Your saved cookie session was rejected.'),
                description: tr('The cookie file was found and used, but the site still requested sign-in. The session may have expired, changed in your browser, or failed a site security check.'),
                steps: [
                    tr('Export a new session from an account that can play the video.'),
                    tr('For YouTube, follow the private-window export steps in the cookies helper, then close that window.'),
                    tr('Import the new file and retry. Saving a file checks its format, not whether the site accepts it.')
                ],
                actionLabel: tr('Import Fresh Cookies'),
                action: () => openCookiesHelperFlow()
            },
            {
                id: 'private_video',
                pattern: /(private|members-only|subscriber-only|login required|sign in to confirm|age-restricted)/i,
                title: tr('This video likely needs account access.'),
                description: tr('The source is rejecting anonymous access for this item.'),
                steps: [
                    tr('Make sure the account you use can actually view the video in the browser.'),
                    tr('Import fresh browser cookies if the site requires sign-in, age checks, or membership.'),
                    tr('Retry after importing cookies so yt-dlp can reuse that session.')
                ],
                actionLabel: tr('Import Cookies'),
                action: () => openCookiesHelperFlow()
            },
            {
                id: 'geo_block',
                pattern: /(not available in your country|not available in your region|geo|region-locked|region blocked)/i,
                title: tr('This looks region-blocked.'),
                description: tr('The site appears to be restricting playback in your current country or region.'),
                steps: [
                    tr('Verify that the video opens normally in your browser from the same machine.'),
                    tr('Use cookies from an account that is allowed to watch the video in that region.'),
                    tr('Retry only after the source itself is accessible; the app cannot bypass geo restrictions.')
                ]
            },
            {
                id: 'rate_limit',
                pattern: /(429|too many requests|rate limit|rate-limit|rate limited|try again later)/i,
                title: tr('The source is rate-limiting requests.'),
                description: tr('You have likely hit a temporary request limit from the site.'),
                steps: [
                    tr('Wait a bit before retrying, especially after several quick attempts.'),
                    tr('Avoid re-fetching the same URL repeatedly in a short burst.'),
                    tr('If the source works better when logged in, import cookies before trying again.')
                ],
                actionLabel: tr('Import Cookies'),
                action: () => openCookiesHelperFlow()
            },
            {
                id: 'stream_protection',
                pattern: /(stream protection|media stream was refused|unable to download video data: http error 403)/i,
                title: tr('YouTube refused the media stream.'),
                description: tr('Your cookies were accepted, but YouTube blocked the video data itself. Re-importing cookies will not fix this.'),
                steps: [
                    tr('Update yt-dlp in Settings; YouTube changes its stream protection often.'),
                    tr('Wait a few minutes and retry the download.'),
                    tr('Pick an MP4 or MKV container so the app can fall back to the HLS stream.')
                ],
                actionLabel: tr('Update Tools'),
                action: () => {
                    openSettingsWithSection(setupHealthSection);
                    setSetupHealthSectionVisibility(true);
                    const updateToolsBtn = document.getElementById('updateToolsBtn');
                    updateToolsBtn?.click();
                }
            },
            {
                id: 'cookies_required',
                pattern: /(cookie|cookies|authentication required|forbidden|http error 403|403 forbidden)/i,
                title: tr('This download likely needs cookies.'),
                description: tr('The source is probably asking for a logged-in browser session.'),
                steps: [
                    tr('Open the cookies helper and import fresh cookies from the browser that can play the video.'),
                    tr('Use cookies from the exact site account that has access to this media.'),
                    tr('Retry after importing to let yt-dlp authenticate with that session.')
                ],
                actionLabel: tr('Import Cookies'),
                action: () => openCookiesHelperFlow()
            },
            {
                id: 'site_unsupported',
                pattern: /(unsupported url|unsupported site|no suitable extractor|unsupported webpage|extractorerror)/i,
                title: tr('This site or URL format may not be supported yet.'),
                description: tr('yt-dlp may not recognize this page, or support may be outdated.'),
                steps: [
                    tr('Double-check that the URL opens to a playable video page in your browser.'),
                    tr('Update yt-dlp and try again in case support was added recently.'),
                    tr('If it still fails, generate diagnostics so you can report the exact extractor error.')
                ],
                actionLabel: tr('Update Tools'),
                action: () => {
                    openSettingsWithSection(setupHealthSection);
                    setSetupHealthSectionVisibility(true);
                    const updateToolsBtn = document.getElementById('updateToolsBtn');
                    updateToolsBtn?.click();
                }
            }
        ];

        const matchedConfig = configs.find((config) => config.pattern.test(normalizedMessage));
        if (matchedConfig) {
            return matchedConfig;
        }

        return {
            id: 'generic',
            title: tr('This looks like a common extractor or setup failure.'),
            description: tr('The source returned an error, but the wording does not map to a single known category.'),
            steps: [
                tr('Retry once in case the source returned a temporary response.'),
                tr('Run the setup health check to confirm yt-dlp, FFmpeg, cookies, and folder access look healthy.'),
                tr('If it keeps failing, report it with diagnostics attached so the exact error can be reviewed.')
            ],
            actionLabel: tr('Report this problem'),
            action: () => {
                openReportProblem({ message: `${tr('A download failed with: {error}', { error: String(errorMessage).slice(0, 500) })}\n\n` });
            }
        };
    }

    // 'failure' after a failed download, 'cookies' for the login expiry warning.
    let failureHelpKind = null;

    function showFailureHelp(errorMessage) {
        if (!failureHelpPanel || !errorMessage) return;
        renderHelpPanel(buildFailureHelpConfig(errorMessage), t('Why did this fail?'), 'failure');
    }

    function renderHelpPanel(config, eyebrow, kind) {
        failureHelpKind = kind;
        if (failureHelpEyebrow) {
            failureHelpEyebrow.textContent = eyebrow;
        }
        if (failureHelpTitle) {
            failureHelpTitle.textContent = config.title;
        }
        if (failureHelpDescription) {
            failureHelpDescription.textContent = config.description;
        }
        if (failureHelpSteps) {
            failureHelpSteps.innerHTML = '';
            config.steps.forEach((step) => {
                const listItem = document.createElement('li');
                listItem.textContent = step;
                failureHelpSteps.appendChild(listItem);
            });
        }

        if (failureHelpPrimaryBtn && config.actionLabel && typeof config.action === 'function') {
            failureHelpPrimaryBtn.innerHTML = `<i class="fas fa-arrow-right"></i> ${escapeHtml(config.actionLabel)}`;
            failureHelpActionHandler = config.action;
            setElementHiddenState(failureHelpActions, false);
        } else {
            failureHelpActionHandler = null;
            setElementHiddenState(failureHelpActions, true);
        }

        setElementHiddenState(failureHelpPanel, false);
    }

    function getHealthStateLabel(state) {
        if (state === 'pass') return t('Ready');
        if (state === 'warn') return t('Needs attention');
        if (state === 'fail') return t('Blocked');
        return t('Checking');
    }

    function formatHealthTimestamp(isoValue) {
        if (!isoValue) return '';
        try {
            return t.formatDate(new Date(isoValue), {
                dateStyle: 'medium',
                timeStyle: 'short'
            });
        } catch (_) {
            return '';
        }
    }

    function renderSetupHealthList(result) {
        if (!setupHealthSummary || !setupHealthList || !setupHealthTimestamp) return;
        setupHealthSummary.textContent = result.summary;
        setupHealthTimestamp.textContent = result.checkedAt
            ? t('Last checked: {time}', { time: formatHealthTimestamp(result.checkedAt) })
            : '';
        setupHealthList.innerHTML = '';

        result.items.forEach((item) => {
            const row = document.createElement('div');
            row.className = 'setup-health-item';

            const heading = document.createElement('div');
            heading.className = 'setup-health-item-heading';

            const label = document.createElement('span');
            label.className = 'setup-health-item-label';
            label.textContent = item.label;

            const badge = document.createElement('span');
            badge.className = `setup-health-state-pill state-${item.state}`;
            badge.textContent = getHealthStateLabel(item.state);

            heading.append(label, badge);

            const detail = document.createElement('p');
            detail.className = 'setup-health-item-detail';
            detail.textContent = item.detail;

            row.append(heading, detail);
            setupHealthList.appendChild(row);
        });
    }

    function renderSetupHealthResult(result) {
        latestSetupHealthResult = result;
        renderSetupHealthList(result);
    }

    function renderSetupHealthLoading(message) {
        const loadingResult = {
            summary: message === undefined ? t('Checking your local setup...') : message,
            checkedAt: '',
            items: [
                { label: t('Network'), state: 'checking', detail: t('Checking connection status...') },
                { label: 'yt-dlp', state: 'checking', detail: t('Checking local yt-dlp installation...') },
                { label: 'FFmpeg', state: 'checking', detail: t('Checking local FFmpeg installation...') },
                { label: t('Cookies helper'), state: 'checking', detail: t('Checking cookies helper availability...') },
                { label: t('Download folder'), state: 'checking', detail: t('Checking folder access and permissions...') }
            ]
        };
        renderSetupHealthResult(loadingResult);
    }

    async function getResolvedDownloadFolderPath() {
        const configuredFolder = getDownloadFolder() || downloadFolderInput?.value || localStorage.getItem('downloadFolder') || '';
        if (configuredFolder) {
            return configuredFolder;
        }
        if (window.electronAPI && window.electronAPI.getDefaultDownloadFolder) {
            try {
                return await window.electronAPI.getDefaultDownloadFolder();
            } catch (error) {
                console.error('Failed to resolve default download folder for health check:', error);
            }
        }
        return '';
    }

    function getToolHealthItem(label, toolInfo, unavailableMessage) {
        const version = toolInfo?.version;
        const versionText = String(version || '').trim();
        const missingVersion = !versionText || /not found|missing|unknown|n\/a|error/i.test(versionText);

        if (missingVersion) {
            return {
                label,
                state: 'fail',
                detail: unavailableMessage
            };
        }

        return {
            label,
            state: 'pass',
            detail: t('Detected {version}', { version: versionText })
        };
    }

    async function runSetupHealthCheck(options = {}) {
        const announce = options.announce === true;

        renderSetupHealthLoading(options.loadingMessage);

        const folderPath = await getResolvedDownloadFolderPath();
        const isOnline = navigator.onLine !== false;

        let toolsStatus = null;
        try {
            toolsStatus = await window.checkToolsStatus();
        } catch (error) {
            console.error('Setup health check could not read tool status:', error);
        }

        const cookiesData = await getSavedCookiesInfo();

        let folderExists = false;
        let folderAccess = null;
        try {
            if (folderPath && window.electronAPI && window.electronAPI.pathExists) {
                folderExists = await window.electronAPI.pathExists(folderPath);
            }
            if (folderExists && window.electronAPI && window.electronAPI.testFolderAccess) {
                folderAccess = await window.electronAPI.testFolderAccess(folderPath);
            }
        } catch (error) {
            console.error('Setup health check could not verify folder access:', error);
        }

        const items = [];
        items.push({
            label: t('Network'),
            state: isOnline ? 'pass' : 'fail',
            detail: isOnline
                ? t('Internet connection looks available.')
                : t('No internet connection detected. Fetching video info and downloads will stay disabled.')
        });

        if (!toolsStatus) {
            items.push({
                label: 'yt-dlp',
                state: 'warn',
                detail: t('Could not query the local tool service for yt-dlp.')
            });
            items.push({
                label: 'FFmpeg',
                state: 'warn',
                detail: t('Could not query the local tool service for FFmpeg.')
            });
        } else {
            items.push(getToolHealthItem('yt-dlp', toolsStatus.ytdlp, t('yt-dlp is missing or not responding.')));
            items.push(getToolHealthItem('FFmpeg', toolsStatus.ffmpeg, t('FFmpeg is missing or not responding.')));
        }

        if (!window.electronAPI || !window.electronAPI.openCookiesHelper) {
            items.push({
                label: t('Cookies helper'),
                state: 'fail',
                detail: t('Cookies helper is unavailable in this environment.')
            });
        } else if (cookiesData.hasCookies) {
            items.push({
                label: t('Cookies helper'),
                state: 'pass',
                detail: t('Your cookies.txt is saved. A download is needed to check whether the site accepts this session.')
            });
        } else {
            items.push({
                label: t('Cookies helper'),
                state: 'warn',
                detail: t('No personal cookies.txt imported yet. Import your own cookies only if a site requires sign-in, age checks, or account access.')
            });
        }

        if (!folderPath) {
            items.push({
                label: t('Download folder'),
                state: 'fail',
                detail: t('No download folder is configured yet.')
            });
        } else if (!folderExists) {
            items.push({
                label: t('Download folder'),
                state: 'fail',
                detail: t('The selected download folder does not exist.')
            });
        } else if (folderAccess?.success) {
            items.push({
                label: t('Download folder'),
                state: 'pass',
                detail: t('Folder exists and is writable.')
            });
        } else if (folderAccess?.error) {
            items.push({
                label: t('Download folder'),
                state: 'fail',
                detail: t('Folder access failed: {error}', { error: serverError(folderAccess) })
            });
        } else {
            items.push({
                label: t('Download folder'),
                state: 'warn',
                detail: t('Folder exists, but write access could not be fully verified here.')
            });
        }

        const blockingCount = items.filter((item) => item.state === 'fail').length;
        const warningCount = items.filter((item) => item.state === 'warn').length;
        const summary = blockingCount === 0 && warningCount === 0
            ? t('Setup looks ready. yt-dlp, FFmpeg, cookies helper, folder access, and network all checked out.')
            : t('Setup check found {issues} and {warnings}.', {
                issues: t.plural(blockingCount, '{count} blocking issue', '{count} blocking issues'),
                warnings: t.plural(warningCount, '{count} warning', '{count} warnings')
            });

        const result = {
            summary,
            checkedAt: new Date().toISOString(),
            items
        };

        localStorage.setItem(SETUP_HEALTH_RUN_KEY, 'true');
        renderSetupHealthResult(result);

        if (announce) {
            announceLiveMessage(summary);
        }

        return result;
    }

    let lastFocusedElement = null;

    function getFocusableElements(container) {
        if (!container) return [];
        return Array.from(container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
            .filter((element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true');
    }

    function openModalWithFocus(modal, preferredFocusElement) {
        if (!modal) return;
        lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        modal.style.display = 'flex';
        modal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-open');
        const focusTarget = preferredFocusElement || getFocusableElements(modal)[0];
        window.setTimeout(() => {
            focusTarget?.focus();
        }, 0);
    }

    function closeModalWithFocusRestore(modal) {
        if (!modal) return;
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('modal-open');
        if (lastFocusedElement && lastFocusedElement.isConnected) {
            lastFocusedElement.focus();
        }
    }

    // --- WebSocket Connection ---
    // Only connect WebSocket if on index.html (where download functionality is)
    if (document.getElementById('youtubeDownloader')) {
        updateNetworkUI();
        connectWebSocket();
    }

    window.addEventListener('online', () => {
        updateNetworkUI({ announce: true });
        if (latestSetupHealthResult || !localStorage.getItem(SETUP_HEALTH_RUN_KEY)) {
            void runSetupHealthCheck();
        }
    });
    window.addEventListener('offline', () => {
        updateNetworkUI({ announce: true });
        if (latestSetupHealthResult || !localStorage.getItem(SETUP_HEALTH_RUN_KEY)) {
            void runSetupHealthCheck();
        }
    });
    window.addEventListener('focus', () => {
        if (latestSetupHealthResult && setupHealthSection && !setupHealthSection.classList.contains('is-hidden-initial')) {
            void runSetupHealthCheck();
        }
    });

    async function connectWebSocket() {
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const baseWsUrl = `${wsProtocol}//${window.location.hostname}:${window.location.port}?clientId=${encodeURIComponent(clientId)}`;
        const wsUrl = window.localApiAuth && typeof window.localApiAuth.buildWebSocketUrl === 'function'
            ? await window.localApiAuth.buildWebSocketUrl(baseWsUrl)
            : baseWsUrl;
        console.log(`Attempting to connect to WebSocket: ${wsUrl}`);

        ws = new WebSocket(wsUrl);
        window.ws = ws; // Make it globally accessible

        ws.onopen = () => {
            void flushDismissedDownloads();
            console.log('WebSocket connection established.');
            // The server re-sends its update state on connect if one is running.
            toolUpdateState = { phase: 'idle', tool: null, activeCount: 0, waitingCount: 0 };
            setServerConnection('ready');
            void refreshCookieHealth({ warn: true });

            const connectionIndicators = document.querySelectorAll('.connection-status');
            connectionIndicators.forEach(indicator => {
                indicator.textContent = t('Connected');
                indicator.className = 'connection-status connected';
            });

            const autoUpdateEnabled = true;
            sendMessageToServer('auto_update_preference', { enabled: autoUpdateEnabled });
            console.log(`Sent auto-update preference to server: ${autoUpdateEnabled ? 'enabled' : 'disabled'}`);
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log('WebSocket message received:', data);

                // Handle ready message specifically
                if (data.type === 'ready') {
                    console.log('Server ready message received');
                    setServerConnection('ready');
                    return;
                }

                handleWebSocketMessage(data);
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
                const currentStatusDiv = youtubeStatusDiv;
                if (currentStatusDiv) {
                    showStatus(t('Error processing message from server.'), 'youtube', 'error');
                }
            }
        };

        ws.onclose = () => {
            console.log('WebSocket connection closed. Attempting to reconnect...');
            setServerConnection('reconnecting');
            setTimeout(connectWebSocket, 3000);
        };

        ws.onerror = (error) => {
            // onclose always follows and moves the status pill to "Reconnecting".
            console.error('WebSocket error:', error);
        };
    }

    function sendMessageToServer(type, payload) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            const message = JSON.stringify({ type, ...payload });
            ws.send(message);
            console.log('WebSocket message sent:', message);
        } else {
            console.error('WebSocket is not connected.');
            const currentStatusDiv = youtubeStatusDiv;
            if (currentStatusDiv) {
                showStatus(t('Not connected to server yet.'), 'youtube', 'error', t('Not connected'));
            }
        }
    }

    // --- Message Handling ---
    function handleWebSocketMessage(data) {
        const { type, message, itemId, downloadUrl, filename, title, actualSize, percent, rawSpeed, speedBytesPerSec, source = activeDownloader, isPlaylistItem, playlistIndex, playlistId, playlistTitle, thumbnail, fullPath, downloadFolder, format, quality } = data;
        if (itemId && (dismissedDownloadItems.has(itemId))) return;
        const currentItemState = downloadItemsState.get(itemId);
        // `message` stays English for the checks below; `shownMessage` is what the user reads.
        const shownMessage = serverText(data);

        // Hide playlist meta items (e.g., 'Fetching playlist: ...')
        if (type === 'queued' && title && title.startsWith('Fetching playlist:')) {
            return;
        }

        const linksArea = getLinksArea(source);
        // Only process download-specific UI updates if the linksArea for that source exists
        if (!linksArea && ['queued', 'item_info', 'progress', 'complete', 'error', 'cancel_confirm'].includes(type)) {
            console.warn(`Download links area for source "${source}" not found on this page. Skipping UI update for item ${itemId}, type ${type}.`);
            return;
        }

        switch (type) {
            case 'queued':
                createDownloadItemStructure(itemId, title || t('Processing...'), source, isPlaylistItem);
                if (format) {
                    updateDownloadItemFormat(itemId, format, source);
                }
                if (quality) {
                    updateDownloadItemQuality(itemId, quality, source);
                }
                if (thumbnail) {
                    updateDownloadItemThumbnail(itemId, thumbnail);
                }
                updateDownloadItemStatus(itemId, shownMessage || t('Queued...'), source);
                // Show pause/play button and remove button immediately for queued items
                const queuedItemDiv = document.getElementById(`item-${itemId}`);
                if (queuedItemDiv) {
                    const pausePlayBtn = queuedItemDiv.querySelector('.item-pause-play-btn');
                    const removeBtn = queuedItemDiv.querySelector('.item-remove-btn');
                    if (pausePlayBtn) pausePlayBtn.style.display = 'inline-flex';
                    if (removeBtn) removeBtn.style.display = 'inline-flex';
                }
                const queuedItemState = downloadItemsState.get(itemId);
                if (queuedItemState) {
                    queuedItemState.status = 'queued';
                    if (format) queuedItemState.format = format;
                    if (quality) queuedItemState.quality = quality;
                    if (thumbnail) queuedItemState.thumbnail = thumbnail;
                }
                updateDownloadStats();
                break;
            case 'item_info':
                if (!downloadItemsState.has(itemId)) {
                    createDownloadItemStructure(itemId, title || t('Fetching info...'), source, isPlaylistItem);
                    // Show pause/play button and remove button for new items
                    const newItemDiv = document.getElementById(`item-${itemId}`);
                    if (newItemDiv) {
                        const pausePlayBtn = newItemDiv.querySelector('.item-pause-play-btn');
                        const removeBtn = newItemDiv.querySelector('.item-remove-btn');
                        if (pausePlayBtn) pausePlayBtn.style.display = 'inline-flex';
                        if (removeBtn) removeBtn.style.display = 'inline-flex';
                    }
                }
                updateDownloadItemTitle(itemId, title, source);
                if (format) {
                    updateDownloadItemFormat(itemId, format, source);
                }
                if (quality) {
                    updateDownloadItemQuality(itemId, quality, source);
                }
                if (thumbnail) updateDownloadItemThumbnail(itemId, thumbnail);
                if (currentItemState) {
                    currentItemState.title = title;
                    if (thumbnail) currentItemState.thumbnail = thumbnail;
                    if (fullPath) currentItemState.fullPath = fullPath;
                    if (format) currentItemState.format = format;
                    if (quality) currentItemState.quality = quality;
                }
                break;
            case 'progress':
                updateDownloadItemProgress(itemId, shownMessage, percent, rawSpeed, source, speedBytesPerSec);
                if (currentItemState) currentItemState.status = 'downloading';
                updateDownloadStats();
                break;
            case 'complete':
                // Use clean title from server if available, otherwise fall back to filename or title
                const displayTitle = data.title || title || filename || t('Download complete');
                updateDownloadItemComplete(itemId, message, downloadUrl, filename, actualSize, source, fullPath, downloadFolder, thumbnail, displayTitle, shownMessage);
                if (userSettings.notificationSound && completionSound) playNotificationSound();
                // Only show notification if user is not on video tab or window is not focused
                const isOnVideoTab = activeDownloader === 'youtube';
                const isWindowFocused = document.hasFocus();
                if (userSettings.notificationPopup && !(isOnVideoTab && isWindowFocused)) {
                    showDesktopNotification(displayTitle, shownMessage || t('Download complete!'));
                }
                showSupportPopupIfEligible();
                if (userSettings.removeCompleted) {
                    setTimeout(() => handleRemoveDownloadItem(itemId, source), 5000);
                }
                if (currentItemState) currentItemState.status = 'complete';
                // Fix playlist categorization
                let subtabKey = source;
                if (source === 'youtube') {
                    if (currentItemState && currentItemState.isPlaylist) {
                        subtabKey = 'youtubePlaylists';
                    } else {
                        subtabKey = 'youtubeSingles';
                    }
                }
                scanDownloadFolderAndUpdateHistory();
                const history = readStoredHistory();

                // Build history item with playlist info for folder grouping
                const historyItem = {
                    name: displayTitle || filename,
                    path: downloadUrl,
                    fullPath: fullPath || null,  // Absolute path from server for reliable file location
                    folder: downloadFolder || getDownloadFolder(),
                    type: subtabKey === 'youtube' ? 'youtubeSingles' : subtabKey,
                    size: actualSize || 'N/A',
                    mtime: new Date().toISOString(),
                    thumbnail: (thumbnail || currentItemState?.thumbnail) || null,
                    clientId: clientId, // Machine-specific ID
                    // Add playlist info for folder grouping (prefer data from server)
                    isPlaylistItem: data.isPlaylistItem || currentItemState?.isPlaylistItem || false,
                    playlistId: data.playlistId || playlistId || currentItemState?.parentPlaylistId || null,
                    playlistTitle: data.playlistTitle || playlistTitle || currentItemState?.playlistTitle || null,
                    format: format || currentItemState?.format || null,
                    quality: quality || currentItemState?.quality || null
                };

                history.unshift(historyItem);
                persistStoredHistory(history);
                updateDownloadStats();
                break;
            case 'error':
                if (!itemId) {
                    showStatus(shownMessage || t('Download request failed.'), 'youtube', 'error');
                    showFailureHelp(message);
                    break;
                }
                createDownloadItemStructure(itemId, title || t('Download failed'), source, isPlaylistItem);
                updateDownloadItemError(itemId, message, source, { displayMessage: shownMessage });
                break;
            case 'cancel_confirm':
                dismissedDownloadItems.add(itemId);
                removeDownloadItemFromUI(itemId);
                break;
            case 'pause_confirm':
                // Update UI to show paused state
                updateDownloadItemStatus(itemId, shownMessage || t('Download paused.'), source, 'info');
                if (currentItemState) currentItemState.status = 'paused';
                // Update the pause/play button to show play icon
                const pausedItemDiv = document.getElementById(`item-${itemId}`);
                if (pausedItemDiv) {
                    const pausePlayBtn = pausedItemDiv.querySelector('.item-pause-play-btn');
                    if (pausePlayBtn) setPausePlayButtonState(pausePlayBtn, true);
                    // Hide progress bar when paused
                    const progressBarContainer = pausedItemDiv.querySelector('.progress-bar-container');
                    if (progressBarContainer) progressBarContainer.style.display = 'none';
                }
                updateDownloadStats();
                break;
            case 'tool_update_state':
                setToolUpdateState({
                    phase: data.phase || 'idle',
                    tool: data.tool || null,
                    activeCount: Number(data.activeCount) || 0,
                    waitingCount: Number(data.waitingCount) || 0
                });
                break;
            case 'tool_update_wait': {
                const waitingItemState = downloadItemsState.get(itemId);
                if (!waitingItemState) break;
                if (data.waiting) {
                    waitingItemState.waitingForToolUpdate = true;
                    updateDownloadItemStatus(itemId, data.tool
                        ? t('Waiting for the {tool} update, starts right after', { tool: data.tool })
                        : t('Waiting for the tool update, starts right after'), source);
                } else if (waitingItemState.waitingForToolUpdate) {
                    waitingItemState.waitingForToolUpdate = false;
                    updateDownloadItemStatus(itemId, t('Starting...'), source);
                }
                break;
            }
            case 'tool_update_complete':
                // Handle automatic tool update notifications (yt-dlp only for auto-updates)
                if ((data.ytdlp && data.ytdlp.updated) || (data.ffmpeg && data.ffmpeg.updated)) {
                    const updateMsg = [
                        data.ytdlp?.updated ? t('yt-dlp updated: {oldVersion} → {newVersion}', { oldVersion: data.ytdlp.oldVersion, newVersion: data.ytdlp.newVersion }) : '',
                        data.ffmpeg?.updated ? t('FFmpeg updated to {version}', { version: data.ffmpeg.newVersion }) : ''
                    ].filter(Boolean).join(' · ');
                    console.log(updateMsg);
                    if (userSettings.notificationPopup) {
                        showDesktopNotification(t('Tool Updated'), updateMsg);
                    }
                    // Show status message
                    const statusDivForUpdate = youtubeStatusDiv;
                    if (statusDivForUpdate) {
                        showStatus(updateMsg, 'youtube', 'success');
                    }
                }
                break;
            case 'status':
                const statusDivForGeneral = youtubeStatusDiv;
                if (statusDivForGeneral) {
                    if (isPotentialRateLimitMessage(message)) {
                        showPotentialRateLimitNotice(shownMessage);
                    } else {
                        showStatus(shownMessage, 'youtube', 'info');
                    }
                }
                // If this is a download status message, show the pause/play button and remove button
                if (message && message.includes('Downloading') && itemId) {
                    const itemDiv = document.getElementById(`item-${itemId}`);
                    if (itemDiv) {
                        const pausePlayBtn = itemDiv.querySelector('.item-pause-play-btn');
                        const removeBtn = itemDiv.querySelector('.item-remove-btn');
                        if (pausePlayBtn) pausePlayBtn.style.display = 'inline-flex';
                        if (removeBtn) removeBtn.style.display = 'inline-flex';
                    }
                }
                break;
            case 'playlist_complete':
                const statusDivForPlaylist = youtubeStatusDiv;
                if (statusDivForPlaylist) {
                    showStatus(shownMessage || t('Playlist processing finished.'), 'youtube', 'success');
                }
                break;
            default:
                console.warn('Unknown WebSocket message type:', type);
        }
    }

    // --- UI Updates ---
    function getLinksArea(source) {
        void source;
        return youtubeDownloadLinksArea;
    }

    // The paused state lives in data-paused; the icon, tooltip and label follow it.
    function setPausePlayButtonState(button, paused) {
        if (!button) return;
        button.dataset.paused = paused ? 'true' : 'false';
        button.innerHTML = paused ? '<i class="fas fa-play"></i>' : '<i class="fas fa-pause"></i>';
        const label = paused ? t('Resume download') : t('Pause download');
        button.title = label;
        button.setAttribute('aria-label', label);
    }

    function createDownloadItemStructure(itemId, titleText, source, isPlaylistItem = false) {
        const linksArea = getLinksArea(source);
        if (!linksArea || downloadItemsState.has(itemId) || dismissedDownloadItems.has(itemId)) return;

        const itemDiv = document.createElement('div');
        itemDiv.className = 'download-item';
        itemDiv.id = `item-${itemId}`;
        itemDiv.dataset.itemId = itemId;

        const thumbnailContainer = document.createElement('div');
        thumbnailContainer.className = 'item-thumbnail-container';

        const thumbnailImg = document.createElement('img');
        thumbnailImg.className = 'item-thumbnail';
        thumbnailImg.src = LOCAL_THUMBNAIL_PLACEHOLDER;
        thumbnailImg.alt = t('{title} thumbnail', { title: titleText });
        thumbnailImg.addEventListener('error', () => {
            thumbnailImg.src = LOCAL_THUMBNAIL_PLACEHOLDER;
        }, { once: true });
        thumbnailContainer.appendChild(thumbnailImg);

        const tagsContainer = document.createElement('div');
        tagsContainer.className = 'item-tags-container';

        const formatTag = document.createElement('span');
        formatTag.className = 'item-format-tag';
        formatTag.textContent = '';
        formatTag.style.display = 'none';
        tagsContainer.appendChild(formatTag);

        const qualityTag = document.createElement('span');
        qualityTag.className = 'item-quality-tag';
        qualityTag.textContent = '';
        qualityTag.style.display = 'none';
        tagsContainer.appendChild(qualityTag);

        thumbnailContainer.appendChild(tagsContainer);
        itemDiv.appendChild(thumbnailContainer);

        const itemContentDiv = document.createElement('div');
        itemContentDiv.className = 'item-content';

        const titleDiv = document.createElement('div');
        titleDiv.className = 'item-title';
        titleDiv.textContent = titleText;
        itemContentDiv.appendChild(titleDiv);

        const statusDiv = document.createElement('div');
        statusDiv.className = 'item-status';
        statusDiv.textContent = t('Queued...');
        statusDiv.setAttribute('role', 'status');
        statusDiv.setAttribute('aria-live', 'polite');
        itemContentDiv.appendChild(statusDiv);

        const progressBarContainer = document.createElement('div');
        progressBarContainer.className = 'progress-bar-container';
        progressBarContainer.style.display = 'none';
        progressBarContainer.setAttribute('role', 'progressbar');
        progressBarContainer.setAttribute('aria-label', t('{title} download progress', { title: titleText }));
        progressBarContainer.setAttribute('aria-valuemin', '0');
        progressBarContainer.setAttribute('aria-valuemax', '100');
        progressBarContainer.setAttribute('aria-valuenow', '0');
        progressBarContainer.setAttribute('aria-valuetext', t('Queued'));

        const progressBar = document.createElement('div');
        progressBar.className = 'progress-bar';
        progressBarContainer.appendChild(progressBar);
        itemContentDiv.appendChild(progressBarContainer);

        const linkDiv = document.createElement('div');
        linkDiv.className = 'item-link';
        itemContentDiv.appendChild(linkDiv);

        itemDiv.appendChild(itemContentDiv);

        const buttonsDiv = document.createElement('div');
        buttonsDiv.className = 'item-buttons';

        // Control buttons row (pause, play, remove)
        const controlButtonsDiv = document.createElement('div');
        controlButtonsDiv.className = 'item-control-buttons';

        const pausePlayBtn = document.createElement('button');
        pausePlayBtn.className = 'item-control-btn item-pause-play-btn';
        setPausePlayButtonState(pausePlayBtn, false);
        pausePlayBtn.style.display = 'none';
        pausePlayBtn.onclick = () => handlePausePlayToggle(itemId, source);
        controlButtonsDiv.appendChild(pausePlayBtn);

        const removeBtn = document.createElement('button');
        removeBtn.className = 'item-control-btn item-remove-btn';
        removeBtn.innerHTML = '<i class="fas fa-times"></i>';
        removeBtn.title = t('Remove this item');
        removeBtn.setAttribute('aria-label', t('Remove this item'));
        removeBtn.style.display = 'none';
        removeBtn.onclick = () => handleRemoveDownloadItem(itemId, source);
        controlButtonsDiv.appendChild(removeBtn);

        const retryBtn = document.createElement('button');
        retryBtn.className = 'item-control-btn item-retry-btn';
        retryBtn.innerHTML = '<i class="fas fa-rotate-right" aria-hidden="true"></i>';
        retryBtn.title = t('Retry this download');
        retryBtn.setAttribute('aria-label', t('Retry this download'));
        retryBtn.style.display = 'none';
        retryBtn.onclick = () => handleRetryDownload(itemId);
        controlButtonsDiv.appendChild(retryBtn);

        buttonsDiv.appendChild(controlButtonsDiv);

        // Cancel button (below control buttons)
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'item-cancel-btn';
        cancelBtn.textContent = t('Cancel');
        cancelBtn.setAttribute('aria-label', t('Cancel download'));
        cancelBtn.onclick = () => handleCancelDownload(itemId, source);
        buttonsDiv.appendChild(cancelBtn);

        itemDiv.appendChild(buttonsDiv);
        if (emptyDownloadState && clearYoutubeDownloadsBtn) {
            emptyDownloadState.style.display = 'none';
            clearYoutubeDownloadsBtn.style.display = 'block';
            linksArea.insertBefore(itemDiv, clearYoutubeDownloadsBtn);
        } else {
            linksArea.prepend(itemDiv);
        }

        downloadItemsState.set(itemId, {
            title: titleText,
            status: 'queued',
            source: source,
            domElement: itemDiv,
            isPlaylist: isPlaylistItem, // Store the playlist flag
            thumbnailEl: thumbnailImg,
            lastAnnouncedProgressBucket: -1,
            retryable: false
        });

        updateDownloadStats();
    }

    function updateDownloadItemStatus(itemId, statusText, source, statusType = 'info') {
        const itemDiv = document.getElementById(`item-${itemId}`);
        if (itemDiv) {
            const statusEl = itemDiv.querySelector('.item-status');
            if (statusEl) {
                statusEl.textContent = statusText;
                statusEl.setAttribute('aria-label', statusText);
                statusEl.className = 'item-status';
                if (statusType === 'error') statusEl.classList.add('error-text');
                if (statusType === 'success') statusEl.classList.add('success-text');
                if (statusType === 'cancelled') statusEl.classList.add('cancelled-text');
            }
            const progressBarContainer = itemDiv.querySelector('.progress-bar-container');
            if (progressBarContainer && (statusType === 'error' || statusType === 'cancelled' || statusType === 'success')) {
                progressBarContainer.style.display = 'none';
            }
        }
    }

    function updateDownloadItemTitle(itemId, newTitle, source) {
        const itemDiv = document.getElementById(`item-${itemId}`);
        if (itemDiv) {
            const titleEl = itemDiv.querySelector('.item-title');
            if (titleEl) {
                titleEl.textContent = newTitle;
            }
        }
    }

    function updateDownloadItemThumbnail(itemId, thumbnailUrl) {
        const itemDiv = document.getElementById(`item-${itemId}`);
        if (itemDiv && thumbnailUrl) {
            const img = itemDiv.querySelector('.item-thumbnail');
            if (img) {
                img.src = thumbnailUrl;
            }
        }
    }

    function updateDownloadItemFormat(itemId, format, source) {
        const itemDiv = document.getElementById(`item-${itemId}`);
        if (itemDiv && format) {
            const formatTag = itemDiv.querySelector('.item-format-tag');
            if (formatTag) {
                formatTag.textContent = format.toUpperCase();
                formatTag.style.display = 'inline-block';
            }
        }
    }

    function updateDownloadItemQuality(itemId, quality, source) {
        const itemDiv = document.getElementById(`item-${itemId}`);
        if (itemDiv && quality) {
            const qualityTag = itemDiv.querySelector('.item-quality-tag');
            if (qualityTag) {
                let qualityText = quality;
                if (quality === 'highest') {
                    qualityText = t('Best');
                } else if (
                    ['8k', '4320', '4320p'].includes(String(quality).toLowerCase())
                ) {
                    qualityText = '8K';
                } else if (
                    ['4k', '2160', '2160p'].includes(String(quality).toLowerCase())
                ) {
                    qualityText = '4K';
                } else if (!isNaN(parseInt(quality))) {
                    qualityText = `${quality}p`;
                }
                qualityTag.textContent = qualityText;
                qualityTag.style.display = 'inline-block';
            }
        }
    }

    // Fixed decimals in the UI language's number style (no thousands grouping,
    // like toFixed); "12.5" in English, "12,5" in German.
    function formatFixed(value, digits) {
        return t.formatNumber(value, { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false });
    }

    function formatPercent(value, digits = 0) {
        return t.formatNumber(value / 100, { style: 'percent', minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false });
    }

    function formatSpeed(speedBytesPerSec, unit) {
        if (typeof speedBytesPerSec !== 'number' || isNaN(speedBytesPerSec)) return '';
        if (unit === 'MBps') {
            return formatFixed(speedBytesPerSec / 1e6, 2) + ' MB/s';
        } else if (unit === 'Mbps') {
            return formatFixed((speedBytesPerSec * 8) / 1e6, 2) + ' Mbps';
        } else {
            return speedBytesPerSec + ' B/s';
        }
    }

    function parseSpeedString(speedStr) {
        if (!speedStr || typeof speedStr !== 'string') return null;
        const match = speedStr.match(/([\d.]+)\s*(K|M|G)?i?B\/s/i);
        if (!match) return null;
        let value = parseFloat(match[1]);
        let unit = match[2] ? match[2].toUpperCase() : '';
        let bytes = value;
        if (unit === 'K') bytes *= 1024;
        else if (unit === 'M') bytes *= 1024 * 1024;
        else if (unit === 'G') bytes *= 1024 * 1024 * 1024;
        return bytes;
    }

    // Cache DOM elements for progress updates to avoid repeated queries
    const progressUpdateCache = new Map();

    // Throttled progress update for better performance
    const throttledProgressUpdate = throttle((itemId, progressData) => {
        requestAnimationFrame(() => {
            updateDownloadItemProgressInternal(itemId, progressData);
        });
    }, 100); // Update max every 100ms

    function updateDownloadItemProgress(itemId, message, percent, rawSpeed, source, speedBytesPerSec) {
        throttledProgressUpdate(itemId, { message, percent, rawSpeed, speedBytesPerSec });
    }

    function updateDownloadItemProgressInternal(itemId, { message, percent, rawSpeed, speedBytesPerSec }) {
        // Skip progress updates if item is already complete
        const itemState = downloadItemsState.get(itemId);
        if (itemState && itemState.status === 'complete') {
            return; // Don't update progress on completed items
        }

        let itemDiv = progressUpdateCache.get(`div-${itemId}`);
        if (!itemDiv) {
            itemDiv = document.getElementById(`item-${itemId}`);
            if (itemDiv) {
                // Cache DOM elements for this item
                progressUpdateCache.set(`div-${itemId}`, itemDiv);
                progressUpdateCache.set(`status-${itemId}`, itemDiv.querySelector('.item-status'));
                progressUpdateCache.set(`progressBar-${itemId}`, itemDiv.querySelector('.progress-bar'));
                progressUpdateCache.set(`progressBarContainer-${itemId}`, itemDiv.querySelector('.progress-bar-container'));
            }
        }

        if (!itemDiv) return;

        const statusEl = progressUpdateCache.get(`status-${itemId}`);
        const progressBarContainer = progressUpdateCache.get(`progressBarContainer-${itemId}`);
        const progressBar = progressUpdateCache.get(`progressBar-${itemId}`);

        let progressText = '';
        if (typeof percent === 'number' && !isNaN(percent)) {
            progressText = formatPercent(percent, 1);
        }
        let speedText = '';
        let speedVal = null;
        if (typeof speedBytesPerSec === 'number' && !isNaN(speedBytesPerSec)) {
            speedVal = speedBytesPerSec;
        } else if (rawSpeed) {
            speedVal = parseSpeedString(rawSpeed);
        }
        if (speedVal !== null) {
            speedText = formatSpeed(speedVal, userSettings.speedUnitDisplay);
        }
        if (speedText) {
            progressText = progressText
                ? t('{percent} at {speed}', { percent: progressText, speed: speedText })
                : speedText;
        }
        if (!progressText && message) {
            progressText = message;
        }
        if (statusEl) statusEl.textContent = progressText || t('Processing...');
        if (progressBarContainer) progressBarContainer.style.display = 'block';
        if (progressBar && typeof percent === 'number' && !isNaN(percent)) {
            const clampedPercent = Math.max(0, Math.min(100, percent));
            progressBar.style.width = `${clampedPercent}%`;
            progressBarContainer.setAttribute('aria-valuenow', String(Math.round(clampedPercent)));
            progressBarContainer.setAttribute('aria-valuetext', progressText || t('{percent} complete', { percent: formatPercent(Math.round(clampedPercent)) }));
        }
        if (statusEl) {
            statusEl.setAttribute('aria-label', progressText || t('Processing...'));
        }

        // Show pause/play button and remove button when download starts (when progress > 0)
        if (typeof percent === 'number' && percent > 0) {
            const pausePlayBtn = itemDiv.querySelector('.item-pause-play-btn');
            const removeBtn = itemDiv.querySelector('.item-remove-btn');
            if (pausePlayBtn) pausePlayBtn.style.display = 'inline-flex';
            if (removeBtn) removeBtn.style.display = 'inline-flex';
        }

        if (typeof percent === 'number' && !isNaN(percent) && itemState) {
            const progressBucket = Math.floor(Math.max(0, Math.min(100, percent)) / 10);
            if (progressBucket > itemState.lastAnnouncedProgressBucket) {
                itemState.lastAnnouncedProgressBucket = progressBucket;
                const title = itemState.title || itemDiv.querySelector('.item-title')?.textContent || t('Download');
                const percentText = formatPercent(Math.round(percent));
                announceLiveMessage(speedText
                    ? t('{title} {percent} complete at {speed}', { title, percent: percentText, speed: speedText })
                    : t('{title} {percent} complete', { title, percent: percentText }));
            }
        }
    }

    function updateDownloadItemComplete(itemId, message, downloadUrl, filename, actualSize, source, fullPath, downloadFolder, thumb, cleanTitle, displayMessage) {
        const itemDiv = document.getElementById(`item-${itemId}`);
        if (itemDiv) {
            // Update title with clean title if provided
            if (cleanTitle) {
                updateDownloadItemTitle(itemId, cleanTitle, source);
                const currentItemState = downloadItemsState.get(itemId);
                if (currentItemState) {
                    currentItemState.title = cleanTitle;
                }
            }

            // Update item state to complete
            const itemState = downloadItemsState.get(itemId);
            if (itemState) {
                itemState.status = 'complete';
                itemState.retryable = false;
            }

            // Force progress bar to 100% before hiding
            const progressBar = itemDiv.querySelector('.progress-bar');
            const progressBarContainer = itemDiv.querySelector('.progress-bar-container');
            if (progressBar) {
                progressBar.style.width = '100%';
            }
            // Hide progress bar after a short delay so user sees 100%
            setTimeout(() => {
                if (progressBarContainer) progressBarContainer.style.display = 'none';
            }, 300);

            // Compact status message: "Download complete • filesize" or the server-provided message
            // `message` is the server's English text (for the checks); show the translation.
            const rawMessage = typeof message === 'string' ? message : '';
            const shownMessage = displayMessage || serverText({ message: rawMessage });
            const completeWithSize = actualSize ? t('Download complete • {size}', { size: actualSize }) : '';
            let statusText = shownMessage || completeWithSize || t('Download complete');
            // If the message is just "Download complete!", append the size if available
            if (rawMessage === 'Download complete!' && actualSize) {
                statusText = completeWithSize;
            } else if (rawMessage.includes('Download complete!') && actualSize && !rawMessage.includes(actualSize)) {
                statusText = shownMessage.replace(t('Download complete!'), completeWithSize);
            }
            updateDownloadItemStatus(itemId, statusText, source, 'success');

            const linkEl = itemDiv.querySelector('.item-link');
            if (linkEl) {
                linkEl.innerHTML = '';

                // Create folder button if we have any way to open the folder
                const hasPath = fullPath || downloadUrl || getDownloadFolder();
                if (hasPath) {
                    const openFolderBtn = document.createElement('button');
                    openFolderBtn.className = 'modern-folder-btn compact-folder-btn';
                    openFolderBtn.title = t('Open containing folder');
                    openFolderBtn.innerHTML = `<i class="fas fa-folder-open"></i> ${escapeHtml(t('Open Folder'))}`;
                    openFolderBtn.onclick = async () => {
                        if (window.electronAPI && window.electronAPI.openPathInExplorer) {
                            try {
                                let targetPath = fullPath;
                                const downloadRoot = downloadFolder || getDownloadFolder();
                                if (!targetPath && downloadUrl && window.electronAPI?.resolvePath) {
                                    const rel = decodeURIComponent(downloadUrl.replace('/downloads/', ''));
                                    targetPath = await window.electronAPI.resolvePath(downloadRoot, rel);
                                }
                                const folderPath = window.electronAPI?.getDirname && targetPath
                                    ? await window.electronAPI.getDirname(targetPath)
                                    : downloadRoot;
                                await window.electronAPI.openPathInExplorer(downloadRoot, folderPath);
                            } catch (e) {
                                console.error('Open folder failed:', e);
                                showAlert(t('Unable to open containing folder.'), t('Error'));
                            }
                        } else {
                            console.error('Open folder not available. window.electronAPI:', window.electronAPI);
                            showAlert(t('Open folder not available. Make sure you are running in Electron.'), t('Not Available'));
                        }
                    };
                    linkEl.appendChild(openFolderBtn);
                }
            }
            if (thumb) updateDownloadItemThumbnail(itemId, thumb);
            disableCancelButton(itemId, source);
            showActionButtons(itemId);

            // Hide pause/play and cancel buttons when download completes
            const pausePlayBtn = itemDiv.querySelector('.item-pause-play-btn');
            if (pausePlayBtn) pausePlayBtn.style.display = 'none';
            const cancelBtn = itemDiv.querySelector('.item-cancel-btn');
            if (cancelBtn) cancelBtn.style.display = 'none';

            // Update download stats
            updateDownloadStats();
        }
    }

    // errorMessage is the server's English text (matched against known causes);
    // displayMessage is its translation when the server sent a message key.
    function updateDownloadItemError(itemId, errorMessage, source, { restored = false, displayMessage = '' } = {}) {
        const itemDiv = document.getElementById(`item-${itemId}`);
        const itemState = downloadItemsState.get(itemId);
        if (itemDiv) {
            const help = buildFailureHelpConfig(errorMessage);
            const summary = help.id === 'generic' ? t('Download failed. Retry or view the error details.') : help.title;
            updateDownloadItemStatus(itemId, summary, source, 'error');
            let details = itemDiv.querySelector('.item-error-details');
            if (!details) {
                details = document.createElement('details');
                details.className = 'item-error-details';
                const label = document.createElement('summary');
                label.textContent = t('Error details');
                details.append(label, document.createElement('p'));
                itemDiv.querySelector('.item-content').appendChild(details);
            }
            details.querySelector('p').textContent = displayMessage || serverError({ error: errorMessage }, t('Download failed'));
            disableCancelButton(itemId, source);
            itemDiv.querySelector('.item-cancel-btn').style.display = 'none';
            itemDiv.querySelector('.item-pause-play-btn').style.display = 'none';
            if (itemState) {
                itemState.retryable = true;
                itemState.status = 'error';
            }
            showActionButtons(itemId);
        }
        updateDownloadStats();
        // A failure restored from a past session must not hide the login warning.
        if (!(restored && failureHelpKind === 'cookies')) showFailureHelp(errorMessage);
    }

    function disableCancelButton(itemId, source) {
        const itemDiv = document.getElementById(`item-${itemId}`);
        if (itemDiv) {
            const cancelBtn = itemDiv.querySelector('.item-cancel-btn');
            if (cancelBtn) {
                cancelBtn.disabled = true;
                cancelBtn.textContent = t('Done');
                cancelBtn.style.opacity = '0.6';
                cancelBtn.style.cursor = 'default';
            }
        }
    }

    function handleCancelDownload(itemId, source) {
        return handleRemoveDownloadItem(itemId, source);
    }

    async function handleRemoveDownloadItem(itemId, source) {
        if (dismissedDownloadItems.has(itemId)) return true;
        try {
            downloadDismissals.dismiss(itemId);
            removeDownloadItemFromUI(itemId);
            if (![...downloadItemsState.values()].some(item => item.retryable)) hideFailureHelp();
            showStatus(t('Download removed.'), source, 'success');
            void flushDismissedDownloads();
            return true;
        } catch (error) {
            showStatus(t('Could not remove download: {error}. Please try again.', { error: error.message }), source, 'error');
            return false;
        }
    }

    async function flushDismissedDownloads() {
        clearTimeout(removalRetryTimer);
        const remaining = await downloadDismissals.flush();
        if (remaining) removalRetryTimer = setTimeout(flushDismissedDownloads, 5000);
    }

    function removeDownloadItemFromUI(itemId) {
        const itemDiv = document.getElementById(`item-${itemId}`);
        if (itemDiv) itemDiv.remove();
        downloadItemsState.delete(itemId);
        // Clear cache for removed item
        progressUpdateCache.delete(`div-${itemId}`);
        progressUpdateCache.delete(`status-${itemId}`);
        progressUpdateCache.delete(`progressBar-${itemId}`);
        progressUpdateCache.delete(`progressBarContainer-${itemId}`);
        updateDownloadStats();
        console.log(`Removed item ${itemId} from UI and state.`);
    }

    function showActionButtons(itemId) {
        const itemDiv = document.getElementById(`item-${itemId}`);
        if (itemDiv) {
            const removeBtn = itemDiv.querySelector('.item-remove-btn');
            if (removeBtn) removeBtn.style.display = 'inline-flex';
            const retryBtn = itemDiv.querySelector('.item-retry-btn');
            const itemState = downloadItemsState.get(itemId);
            if (retryBtn) {
                retryBtn.style.display = itemState?.retryable ? 'inline-flex' : 'none';
            }
        }
    }

    async function handleRetryDownload(itemId) {
        const state = downloadItemsState.get(itemId);
        if (!state || state.retrying) return false;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            showStatus(t('Waiting for the download server to reconnect. Please retry once connected.'), state.source, 'connecting');
            return false;
        }
        state.retrying = true;
        const retryButton = document.getElementById(`item-${itemId}`)?.querySelector('.item-retry-btn');
        if (retryButton) retryButton.disabled = true;
        try {
            const response = await window.localApiAuth.authorizedFetch(`/failed-downloads/${encodeURIComponent(itemId)}/retry`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ clientId })
            });
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(serverError(data, t('Retry failed with {status}', { status: response.status })));
            }
            const result = await response.json();
            if (result.newItemId && !downloadItemsState.has(result.newItemId)) {
                createDownloadItemStructure(result.newItemId, state.title, state.source);
            }
            const itemState = downloadItemsState.get(itemId);
            if (itemState) {
                itemState.retryable = false;
                itemState.status = 'queued';
            }
            dismissedDownloadItems.add(itemId);
            removeDownloadItemFromUI(itemId);
            showStatus(t('Retry requested...'), 'youtube', 'success');
            return true;
        } catch (error) {
            showStatus(t('Could not retry download: {error}', { error: error.message }), 'youtube', 'error');
            return false;
        } finally {
            state.retrying = false;
            if (retryButton) retryButton.disabled = false;
        }
    }

    // Dynamic pause/play toggle function
    function handlePausePlayToggle(itemId, source) {
        const itemDiv = document.getElementById(`item-${itemId}`);
        if (itemDiv) {
            const pausePlayBtn = itemDiv.querySelector('.item-pause-play-btn');
            if (pausePlayBtn) {
                const isPaused = pausePlayBtn.dataset.paused === 'true';
                const currentItemState = downloadItemsState.get(itemId);

                if (isPaused) {
                    // Currently paused, resume download
                    console.log(`Resuming download for item: ${itemId}, source: ${source}`);
                    sendMessageToServer('resume', { itemId: itemId });
                    setPausePlayButtonState(pausePlayBtn, false);
                    updateDownloadItemStatus(itemId, t('Resuming...'), source);

                    // Update state
                    if (currentItemState) currentItemState.status = 'resuming';

                    // Show progress bar again
                    const progressBarContainer = itemDiv.querySelector('.progress-bar-container');
                    if (progressBarContainer) progressBarContainer.style.display = 'block';
                } else {
                    // Currently downloading, pause download
                    console.log(`Pausing download for item: ${itemId}, source: ${source}`);
                    sendMessageToServer('pause', { itemId: itemId });
                    setPausePlayButtonState(pausePlayBtn, true);
                    updateDownloadItemStatus(itemId, t('Pausing...'), source);

                    // Update state (will be confirmed by pause_confirm from server)
                    if (currentItemState) currentItemState.status = 'pausing';
                }
            }
        }
        updateDownloadStats();
    }

    // --- Download Initiation ---
    async function fetchVideoInfo(url, source, options = {}) {
        if (!youtubeUrlInput) return null;
        const { forceRefresh = false, showErrors = true } = options;
        const normalizedUrl = normalizePreviewUrl(url);
        if (!normalizedUrl) {
            return null;
        }

        const cachedPreviewInfo = !forceRefresh ? getCachedPreviewInfo(normalizedUrl) : null;
        if (cachedPreviewInfo) {
            return cachedPreviewInfo;
        }

        const pendingPreviewRequest = pendingPreviewRequests.get(normalizedUrl);
        if (pendingPreviewRequest) {
            return pendingPreviewRequest;
        }

        if (navigator.onLine === false) {
            if (showErrors) {
                showStatus(t("You're offline. Reconnect to load video info."), source, 'offline');
            }
            return null;
        }
        if (showErrors) {
            hideFailureHelp();
        }

        // Check if URL is blocked
        const blocked = window.contentFilter_isBlockedUrl ? window.contentFilter_isBlockedUrl(normalizedUrl) : { blocked: false };
        if (blocked.blocked) {
            if (showErrors) {
                const statusDiv = youtubeStatusDiv;
                if (statusDiv) {
                    const reason = blocked.reason === 'pornography'
                        ? t('Pornography sites are not allowed.')
                        : t('Gambling sites are not allowed.');
                    showStatus(reason, source, 'error');
                }
            }
            return null;
        }

        const requestPromise = (async () => {
            try {
                const response = await window.localApiAuth.authorizedFetch('/video-info', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: normalizedUrl, clientId, source })
                });
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({ error: t('Failed to parse error response') }));
                    throw Object.assign(new Error(errorData.error || `HTTP error ${response.status}`), { displayMessage: serverError(errorData, t('HTTP error {status}', { status: response.status })) });
                }
                const videoInfo = await response.json();
                setCachedPreviewInfo(normalizedUrl, videoInfo);
                return videoInfo;
            } catch (error) {
                console.error(`Error fetching video info for ${normalizedUrl} (${source}):`, error);
                if (showErrors) {
                    const statusDiv = youtubeStatusDiv;
                    if (statusDiv) {
                        showStatus(t('Error fetching info: {error}', { error: error.displayMessage || error.message }), source, 'error');
                    }
                    showFailureHelp(error.message);
                }
                return null;
            } finally {
                pendingPreviewRequests.delete(normalizedUrl);
            }
        })();

        pendingPreviewRequests.set(normalizedUrl, requestPromise);
        return requestPromise;
    }

    async function fetchPlaylistPreview(url) {
        const response = await window.localApiAuth.authorizedFetch('/playlist-preview', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                url,
                clientId
            })
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw Object.assign(new Error(data.error || `Playlist preview failed with ${response.status}`), { displayMessage: serverError(data, t('Playlist preview failed with {status}', { status: response.status })) });
        }
        return response.json();
    }

    function renderPlaylistSelectionItems(preview) {
        if (!playlistSelectionList) return;
        playlistSelectionList.innerHTML = '';
        preview.items.forEach((item) => {
            const label = document.createElement('label');
            label.className = 'playlist-selection-item';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = item.id;
            checkbox.checked = true;
            checkbox.dataset.playlistId = item.id;

            const thumbWrap = document.createElement('span');
            thumbWrap.className = 'playlist-selection-thumb';
            const fallbackIcon = document.createElement('i');
            fallbackIcon.className = 'fas fa-film';
            fallbackIcon.setAttribute('aria-hidden', 'true');
            thumbWrap.appendChild(fallbackIcon);
            if (typeof item.thumbnail === 'string' && /^https:\/\//i.test(item.thumbnail)) {
                const img = document.createElement('img');
                img.alt = '';
                img.loading = 'lazy';
                img.decoding = 'async';
                img.referrerPolicy = 'no-referrer';
                img.addEventListener('error', () => img.remove(), { once: true });
                img.src = item.thumbnail;
                thumbWrap.appendChild(img);
            }
            if (item.duration) {
                const duration = document.createElement('span');
                duration.className = 'playlist-selection-duration';
                duration.textContent = item.duration;
                thumbWrap.appendChild(duration);
            }

            const info = document.createElement('span');
            info.className = 'playlist-selection-info';
            const index = document.createElement('span');
            index.className = 'playlist-selection-index';
            index.textContent = `#${item.index + 1}`;
            const title = document.createElement('span');
            title.className = 'playlist-selection-title';
            title.textContent = item.title;
            title.title = item.title;
            info.append(index, title);

            label.append(checkbox, thumbWrap, info);
            playlistSelectionList.appendChild(label);
        });
        updatePlaylistSelectionState();
    }

    function updatePlaylistSelectionState() {
        const checkboxes = Array.from(playlistSelectionList?.querySelectorAll('input[type="checkbox"]') || []);
        const selected = checkboxes.filter((checkbox) => checkbox.checked).length;
        const allSelected = checkboxes.length > 0 && selected === checkboxes.length;
        if (playlistSelectionCount) {
            playlistSelectionCount.textContent = t('{selected} of {total} selected', { selected: t.formatNumber(selected), total: t.formatNumber(checkboxes.length) });
        }
        if (playlistSelectAllBtn) {
            playlistSelectAllBtn.innerHTML = allSelected
                ? `<i class="fas fa-square-minus" aria-hidden="true"></i> <span>${escapeHtml(t('Deselect all'))}</span>`
                : `<i class="fas fa-square-check" aria-hidden="true"></i> <span>${escapeHtml(t('Select all'))}</span>`;
            playlistSelectAllBtn.disabled = checkboxes.length === 0;
        }
        if (confirmPlaylistSelectionBtn) {
            confirmPlaylistSelectionBtn.disabled = selected === 0;
        }
    }

    function getSelectedPlaylistItemIds() {
        if (!playlistSelectionList) return [];
        return Array.from(playlistSelectionList.querySelectorAll('input[type="checkbox"]:checked'))
            .map((checkbox) => checkbox.value);
    }

    async function openPlaylistSelectionFlow(requestPayload) {
        const preview = await fetchPlaylistPreview(requestPayload.url);
        pendingPlaylistSelectionRequest = requestPayload;
        if (playlistSelectionSummary) {
            playlistSelectionSummary.textContent = t.plural(preview.items.length, '{title} • {count} item found.', '{title} • {count} items found.', { title: preview.title });
        }
        renderPlaylistSelectionItems(preview);
        if (playlistSelectionModal) {
            openModalWithFocus(playlistSelectionModal, closePlaylistSelectionBtn || confirmPlaylistSelectionBtn);
        }
    }

    function closePlaylistSelectionFlow() {
        pendingPlaylistSelectionRequest = null;
        if (playlistSelectionModal) {
            closeModalWithFocusRestore(playlistSelectionModal);
        }
        if (playlistSelectionList) {
            playlistSelectionList.innerHTML = '';
        }
    }

    function getYouTubeVideoIdFromUrl(value) {
        try {
            const parsed = new URL(String(value || ''));
            const host = parsed.hostname.replace(/^(www|m|music)\./, '');
            let id = null;
            if (host === 'youtu.be') {
                id = parsed.pathname.slice(1).split('/')[0];
            } else if (host === 'youtube.com') {
                id = parsed.searchParams.get('v') || (parsed.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{11})/) || [])[1];
            }
            return /^[\w-]{11}$/.test(id || '') ? id : null;
        } catch {
            return null;
        }
    }

    function createScheduledDownloadItem(schedule) {
        const itemId = schedule.scheduleId;
        createDownloadItemStructure(itemId, schedule.title || t('Scheduled download'), schedule.source || 'youtube', schedule.playlistAction === 'full');
        updateDownloadItemStatus(itemId, t('Scheduled for {time}', { time: t.formatDate(new Date(schedule.scheduledFor), { dateStyle: 'short', timeStyle: 'medium' }) }), schedule.source || 'youtube', 'info');
        const itemState = downloadItemsState.get(itemId);
        if (itemState) {
            itemState.status = 'scheduled';
            itemState.scheduleId = schedule.scheduleId;
            itemState.retryable = false;
        }
        const scheduledVideoId = getYouTubeVideoIdFromUrl(schedule.url);
        if (scheduledVideoId) {
            updateDownloadItemThumbnail(itemId, `https://i.ytimg.com/vi/${scheduledVideoId}/mqdefault.jpg`);
        }
        const itemDiv = document.getElementById(`item-${itemId}`);
        if (itemDiv) {
            itemDiv.classList.add('is-scheduled');
            const pausePlayBtn = itemDiv.querySelector('.item-pause-play-btn');
            const retryBtn = itemDiv.querySelector('.item-retry-btn');
            const cancelBtn = itemDiv.querySelector('.item-cancel-btn');
            const removeBtn = itemDiv.querySelector('.item-remove-btn');
            if (pausePlayBtn) pausePlayBtn.style.display = 'none';
            if (retryBtn) retryBtn.style.display = 'none';
            if (removeBtn) removeBtn.style.display = 'inline-flex';
            if (cancelBtn) {
                cancelBtn.textContent = t('Cancel Schedule');
                cancelBtn.onclick = () => handleDeleteScheduledDownload(schedule.scheduleId);
            }
        }
    }

    // Anonymous usage statistics are opt-in. The backend owns the install ID and
    // queue; if it and this window disagree, "off" wins on both sides.
    async function setUsageStatsOnServer(enabled) {
        try {
            const response = await window.localApiAuth.authorizedFetch('/api/usage-stats', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled: enabled === true })
            });
            return response.ok ? await response.json() : null;
        } catch (_) {
            return null;
        }
    }

    async function reconcileUsageStats() {
        try {
            const response = await window.localApiAuth.authorizedFetch('/api/usage-stats');
            if (!response.ok) return;
            const status = await response.json();
            const localEnabled = userSettings.usageStats === true;
            if (status.enabled === localEnabled) return;
            if (status.enabled) {
                await setUsageStatsOnServer(false);
            } else {
                userSettings.usageStats = false;
                userSettings.errorTelemetry = false;
                saveUserSettingsToStorage();
                const usageStatsCheckbox = document.getElementById('usageStats');
                if (usageStatsCheckbox) usageStatsCheckbox.checked = false;
            }
        } catch (_) {
            // Best effort only; the backend defaults to off.
        }
    }

    async function loadRecoverableDownloads() {
        try {
            const [recoverableResponse, scheduledResponse, failedResponse] = await Promise.all([
                window.localApiAuth.authorizedFetch(`/recoverable-downloads?clientId=${encodeURIComponent(clientId)}`),
                window.localApiAuth.authorizedFetch(`/scheduled-downloads?clientId=${encodeURIComponent(clientId)}`),
                window.localApiAuth.authorizedFetch(`/failed-downloads?clientId=${encodeURIComponent(clientId)}`)
            ]);

            if (recoverableResponse.ok) {
                const data = await recoverableResponse.json();
                (data.items || []).forEach((item) => {
                    if (dismissedDownloadItems.has(item.itemId)) return;
                    createDownloadItemStructure(item.itemId, item.title || t('Recoverable download'), item.source || 'youtube', item.isPlaylistItem);
                    showActionButtons(item.itemId);
                    updateDownloadItemStatus(item.itemId, t('Paused. Ready to resume after restart.'), item.source || 'youtube', 'info');
                    const itemState = downloadItemsState.get(item.itemId);
                    if (itemState) {
                        itemState.status = 'paused';
                    }
                    const itemDiv = document.getElementById(`item-${item.itemId}`);
                    const pausePlayBtn = itemDiv?.querySelector('.item-pause-play-btn');
                    if (pausePlayBtn) {
                        pausePlayBtn.style.display = 'inline-flex';
                        setPausePlayButtonState(pausePlayBtn, true);
                    }
                });
            }

            if (scheduledResponse.ok) {
                const data = await scheduledResponse.json();
                (data.items || []).forEach((schedule) => {
                    createScheduledDownloadItem(schedule);
                });
            }

            if (failedResponse.ok) {
                const data = await failedResponse.json();
                (data.items || []).forEach((failed) => {
                    if (dismissedDownloadItems.has(failed.itemId)) return;
                    createDownloadItemStructure(failed.itemId, failed.title || t('Failed download'), failed.source || 'youtube', false);
                    updateDownloadItemError(failed.itemId, failed.message || 'Download failed', failed.source || 'youtube', { restored: true, displayMessage: serverText(failed, serverError(failed, t('Download failed'))) });
                    if (failed.thumbnail) updateDownloadItemThumbnail(failed.itemId, failed.thumbnail);
                    if (failed.format) updateDownloadItemFormat(failed.itemId, failed.format);
                    if (failed.quality) updateDownloadItemQuality(failed.itemId, failed.quality);
                });
            }
        } catch (error) {
            console.warn('Could not load recoverable download state:', error);
        }
    }

    async function handleDeleteScheduledDownload(scheduleId) {
        try {
            const response = await window.localApiAuth.authorizedFetch(`/scheduled-downloads/${encodeURIComponent(scheduleId)}?clientId=${encodeURIComponent(clientId)}`, {
                method: 'DELETE'
            });
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(serverError(data, t('Schedule delete failed with {status}', { status: response.status })));
            }
            handleRemoveDownloadItem(scheduleId, 'youtube');
        } catch (error) {
            showStatus(t('Could not cancel scheduled download: {error}', { error: error.message }), 'youtube', 'error');
        }
    }

    async function startDownloadCommon(url, format, quality, source, playlistActionVal, concurrencyVal, singleConcurrencyVal, options = {}) {
        const statusDiv = youtubeStatusDiv;
        if (!url) {
            if (statusDiv) showStatus(t('Please paste a URL.'), source, 'error');
            return;
        }
        if (navigator.onLine === false) {
            if (statusDiv) showStatus(t("You're offline. Reconnect to download."), source, 'offline');
            return;
        }

        // Check if URL is blocked
        const blocked = window.contentFilter_isBlockedUrl ? window.contentFilter_isBlockedUrl(url) : { blocked: false };
        if (blocked.blocked) {
            if (statusDiv) {
                const reason = blocked.reason === 'pornography'
                    ? t('Pornography sites are not allowed.')
                    : t('Gambling sites are not allowed.');
                showStatus(reason, source, 'error');
            }
            return;
        }

        if (statusDiv) showStatus(t('Requesting download...'), source, 'info');
        hideFailureHelp();

        const hdrOverride = options.preferHdr ?? hdrModeOverrideSelect?.value;
        const preferHdr = hdrOverride === 'enabled'
            ? true
            : hdrOverride === 'disabled'
                ? false
                : userSettings.preferHdr === true;
        const payload = {
            url, format, quality, clientId, source,
            playlistAction: playlistActionVal,
            concurrency: concurrencyVal,
            singleConcurrency: singleConcurrencyVal,
            selectedPlaylistItems: Array.isArray(options.selectedPlaylistItems) ? options.selectedPlaylistItems : [],
            ...userSettings,
            preferHdr,
            downloadFolder: getDownloadFolder()
        };
        const scheduledFor = scheduleDownloadToggle?.checked ? scheduleDownloadAt?.value : '';
        if (scheduledFor) {
            payload.scheduledFor = scheduledFor;
            payload.previewTitle = youtubeUrlInput?.value?.trim() || url;
            const response = await window.localApiAuth.authorizedFetch('/scheduled-downloads', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(serverError(data, t('Scheduling failed with {status}', { status: response.status })));
            }
            const scheduled = await response.json();
            createScheduledDownloadItem({
                scheduleId: scheduled.scheduleId,
                scheduledFor: scheduled.scheduledFor,
                title: payload.previewTitle,
                url,
                source,
                format,
                quality,
                playlistAction: playlistActionVal
            });
            if (statusDiv) {
                showStatus(t('Download scheduled for {time}.', { time: t.formatDate(new Date(scheduled.scheduledFor), { dateStyle: 'short', timeStyle: 'medium' }) }), source, 'success');
            }
            return;
        }
        const normalizedUrl = normalizePreviewUrl(url);
        if (source === 'youtube' && isPreviewableUrl(normalizedUrl) && !isLikelyPlaylistUrl(normalizedUrl) && !getCachedPreviewInfo(normalizedUrl)) {
            fetchVideoInfo(normalizedUrl, source, { showErrors: false }).catch((error) => {
                console.warn('Failed to warm preview metadata before download:', error);
            });
        }
        sendMessageToServer('download_request', payload);
    }

    if (startYoutubeDownloadBtn) {
        startYoutubeDownloadBtn.onclick = async () => {
            // --- First-run rights confirmation ---
            const hasConfirmedRights = localStorage.getItem('simplyytd_rights_confirmed') === 'true';
            const firstRunBox = document.getElementById('firstRunConfirmation');
            const confirmCheckbox = document.getElementById('confirmRightsCheckbox');

            if (!hasConfirmedRights) {
                // Show confirmation box if not already confirmed
                if (firstRunBox) {
                    firstRunBox.style.display = 'block';
                }

                if (confirmCheckbox && !confirmCheckbox.checked) {
                    showStatus(t('Please confirm you have the rights to download this content.'), 'youtube', 'error');
                    confirmCheckbox.focus();
                    return;
                }

                // Save confirmation
                if (confirmCheckbox && confirmCheckbox.checked) {
                    localStorage.setItem('simplyytd_rights_confirmed', 'true');
                    if (firstRunBox) firstRunBox.style.display = 'none';
                }
            }

            const url = youtubeUrlInput.value.trim();
            const format = formatSelect.value;
            const qualityVal = qualitySelect.value;
            const singleConcurrencySelect = document.getElementById('singleConcurrencySelect');
            const singleConcurrency = singleConcurrencySelect ? singleConcurrencySelect.value : '1';
            // Check if playlist options are visible (detected by detectPlaylist function)
            const isPlaylist = playlistOptionsDiv && playlistOptionsDiv.style.display !== 'none';
            const playlistAction = isPlaylist && playlistActionSelect ? playlistActionSelect.value : 'single';
            const concurrency = isPlaylist && playlistAction === 'full' && playlistConcurrencySelect ? playlistConcurrencySelect.value : 1;

            // Use 'youtube' source for backwards compatibility, but backend will handle all sites uniformly
            const requestPayload = {
                url,
                format,
                quality: qualityVal,
                source: 'youtube',
                playlistAction,
                concurrency: parseInt(concurrency),
                singleConcurrency: parseInt(singleConcurrency),
                preferHdr: hdrModeOverrideSelect?.value || 'settings'
            };
            try {
                if (isPlaylist && playlistAction === 'full') {
                    await openPlaylistSelectionFlow(requestPayload);
                    return;
                }
                await startDownloadCommon(url, format, qualityVal, 'youtube', playlistAction, parseInt(concurrency), parseInt(singleConcurrency));
            } catch (error) {
                showStatus(t('Could not start download: {error}', { error: error.displayMessage || error.message }), 'youtube', 'error');
            }
        };
    }

    // --- Quality Options & Playlist Detection ---
    // --- Quality Options & Playlist Detection ---
    function populateQualityOptions(selectElement, format, source, preserveValue = false) {
        if (!selectElement) return;

        // Store current value if we want to preserve it
        const currentValue = preserveValue ? selectElement.value : null;
        selectElement.innerHTML = '';

        const videoFormats = ['mp4', 'mkv', 'mov', 'webm'];
        const audioFormats = ['mp3', 'wav', 'm4a', 'opus', 'flac'];
        const isVideoFormat = videoFormats.includes(format);
        const isAudioFormat = audioFormats.includes(format);

        let qualities = [];
        if (source === 'youtube') {
            if (isVideoFormat) {
                qualities = [
                    { value: 'highest', text: t('Best available (up to 8K)') },
                    { value: '4320', text: '8K (4320p)' },
                    { value: '2160', text: '4K (2160p)' },
                    { value: '1440', text: '2K (1440p)' },
                    { value: '1080', text: '1080p' },
                    { value: '720', text: '720p' },
                    { value: '480', text: '480p' },
                    { value: '360', text: '360p' }
                ];
            } else if (isAudioFormat) {
                qualities = [
                    { value: 'highest', text: t('Highest Quality') },
                    { value: '320', text: '320 kbps' },
                    { value: '256', text: '256 kbps' },
                    { value: '192', text: '192 kbps' },
                    { value: '128', text: '128 kbps' }
                ];
            }
        }

        let foundPreservedValue = false;
        qualities.forEach(q => {
            const option = document.createElement('option');
            option.value = q.value;
            option.textContent = q.text;
            // Restore previous selection if it exists in the new list
            if (preserveValue && currentValue && q.value === currentValue) {
                option.selected = true;
                foundPreservedValue = true;
            }
            selectElement.appendChild(option);
        });

        // If the preserved value wasn't found, keep the default (first option)
        if (preserveValue && currentValue && !foundPreservedValue) {
            selectElement.selectedIndex = 0;
        }
    }

    // Remember the last Format, Quality and Concurrent downloads the user picked.
    // These pickers live on the main form, so every change is saved straight away
    // and restored on the next launch (or after any reload of the window).
    // With "Remember my last choices" off, changes are not saved and the pickers
    // start from the same saved choices (from setup) every time.
    function shouldRememberDownloadChoices() {
        return userSettings?.rememberDownloadChoices !== false;
    }

    function persistDownloadPreferences(patch) {
        if (!shouldRememberDownloadChoices()) return;
        userSettings = { ...(userSettings || {}), ...patch };
        window.userSettings = userSettings;
        try {
            saveUserSettingsToStorage();
        } catch (error) {
            console.warn('Unable to save download preferences:', error);
        }
    }

    function selectHasValue(selectElement, value) {
        return Boolean(selectElement) && value !== undefined && value !== null &&
            Array.from(selectElement.options).some(option => option.value === String(value));
    }

    if (formatSelect && qualitySelect) {
        formatSelect.addEventListener('change', () => {
            populateQualityOptions(qualitySelect, formatSelect.value, 'youtube', true);
            persistDownloadPreferences({
                defaultFormat: formatSelect.value,
                defaultQuality: qualitySelect.value
            });
        });
        qualitySelect.addEventListener('change', () => {
            persistDownloadPreferences({ defaultQuality: qualitySelect.value });
        });
        const savedFormat = userSettings.defaultFormat || formatSelect.value;
        if (selectHasValue(formatSelect, savedFormat)) {
            formatSelect.value = savedFormat;
        }
        populateQualityOptions(qualitySelect, formatSelect.value, 'youtube');
        const savedQuality = userSettings.defaultQuality || 'highest';
        if (selectHasValue(qualitySelect, savedQuality)) {
            qualitySelect.value = savedQuality;
        }
    }

    const singleConcurrencyPicker = document.getElementById('singleConcurrencySelect');
    if (singleConcurrencyPicker) {
        if (selectHasValue(singleConcurrencyPicker, userSettings.defaultConcurrency)) {
            singleConcurrencyPicker.value = String(userSettings.defaultConcurrency);
        }
        singleConcurrencyPicker.addEventListener('change', () => {
            persistDownloadPreferences({ defaultConcurrency: singleConcurrencyPicker.value });
        });
    }
    if (playlistConcurrencySelect) {
        if (selectHasValue(playlistConcurrencySelect, userSettings.playlistConcurrency)) {
            playlistConcurrencySelect.value = String(userSettings.playlistConcurrency);
        }
        playlistConcurrencySelect.addEventListener('change', () => {
            persistDownloadPreferences({ playlistConcurrency: playlistConcurrencySelect.value });
        });
    }
    function detectPlaylist() {
        if (!youtubeUrlInput || !playlistOptionsDiv) return;
        const url = youtubeUrlInput.value.trim();
        // Check for common playlist indicators (yt-dlp will handle actual detection)
        const isPlaylist = isLikelyPlaylistUrl(url);
        playlistOptionsDiv.style.display = isPlaylist ? 'block' : 'none';
        if (playlistOptionsDiv.style.display === 'block' && playlistActionSelect) {
            playlistActionSelect.dispatchEvent(new Event('change'));
        }
    }
    if (youtubeUrlInput && playlistOptionsDiv && playlistActionSelect) {
        youtubeUrlInput.addEventListener('input', () => {
            detectPlaylist();
            scheduleYoutubePreview();
        });
        youtubeUrlInput.addEventListener('blur', () => {
            scheduleYoutubePreview({ immediate: true });
        });
        detectPlaylist();
    }
    if (playlistActionSelect) {
        playlistActionSelect.addEventListener('change', () => {
            const concurrencyGroup = document.getElementById('concurrencyGroup');
            if (concurrencyGroup) {
                concurrencyGroup.style.display = playlistActionSelect.value === 'full' ? 'block' : 'none';
            }
        });
        const initialConcurrencyGroup = document.getElementById('concurrencyGroup');
        if (initialConcurrencyGroup) {
            initialConcurrencyGroup.style.display = playlistActionSelect.value === 'full' ? 'block' : 'none';
        }
    }

    if (scheduleDownloadToggle && scheduleDownloadAt) {
        scheduleDownloadToggle.addEventListener('change', () => {
            const showScheduler = scheduleDownloadToggle.checked === true;
            if (showScheduler && advancedDownloadOptions) {
                advancedDownloadOptions.open = true;
            }
            setElementHiddenState(scheduleDownloadAt, !showScheduler);
            scheduleDownloadAt.style.display = showScheduler ? 'block' : 'none';
            if (showScheduler && !scheduleDownloadAt.value) {
                const defaultDate = new Date(Date.now() + 15 * 60 * 1000);
                const localValue = new Date(defaultDate.getTime() - defaultDate.getTimezoneOffset() * 60000)
                    .toISOString()
                    .slice(0, 16);
                scheduleDownloadAt.value = localValue;
            }
        });

        const showScheduler = scheduleDownloadToggle.checked === true;
        if (advancedDownloadOptions && showScheduler) {
            advancedDownloadOptions.open = true;
        }
        setElementHiddenState(scheduleDownloadAt, !showScheduler);
        scheduleDownloadAt.style.display = showScheduler ? 'block' : 'none';
    }

    // --- Tab Management ---
    function showTab(tab) {
        ['youtubeDownloader', 'historyPanel'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        ['youtubeTab', 'historyTab'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.remove('active');
        });
        const panelId = tab === 'history' ? 'historyPanel' : `${tab}Downloader`;
        const navId = `${tab}Tab`;
        const panel = document.getElementById(panelId);
        const nav = document.getElementById(navId);
        if (panel) panel.style.display = 'block';
        if (nav) nav.classList.add('active');
        activeDownloader = tab;
        localStorage.setItem('activeDownloader', tab);
        if (tab === 'youtube') {
            detectPlaylist();
        }
    }
    if (youtubeTab) youtubeTab.onclick = (e) => { e.preventDefault(); showTab('youtube'); };
    if (historyTab) historyTab.onclick = (e) => { e.preventDefault(); showTab('history'); };

    // --- Theme Management ---
    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
        // Arrow icons are handled by CSS theme-specific rules
        document.querySelectorAll('.progress-bar').forEach(pb => {
            if (!pb) return;
            pb.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--progress-bar-bg').trim();
        });
    }

    // --- UI Scale Management ---
    const UI_SCALE_MIN = 0.6;
    const UI_SCALE_STANDARD_MIN = 0.7;
    const UI_SCALE_STANDARD_MAX = 1.1;
    const UI_SCALE_MAX = 1.5;
    const UI_SCALE_MIN_FONT_PX = 12;
    const UI_SCALE_LOW_FONT_PX = 14;
    const UI_SCALE_STANDARD_FONT_PX = 16;
    const UI_SCALE_STANDARD_MAX_FONT_PX = 16.5;
    const UI_SCALE_MAX_FONT_PX = 18;

    function clampNumber(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function getUIScaleFontSizePx(scale) {
        const safeScale = clampNumber(Number(scale) || 1, UI_SCALE_MIN, UI_SCALE_MAX);

        if (safeScale <= UI_SCALE_STANDARD_MIN) {
            const progress = (safeScale - UI_SCALE_MIN) / (UI_SCALE_STANDARD_MIN - UI_SCALE_MIN);
            return UI_SCALE_MIN_FONT_PX + (clampNumber(progress, 0, 1) * (UI_SCALE_LOW_FONT_PX - UI_SCALE_MIN_FONT_PX));
        }

        if (safeScale <= UI_SCALE_STANDARD_MAX) {
            const progress = (safeScale - UI_SCALE_STANDARD_MIN) / (UI_SCALE_STANDARD_MAX - UI_SCALE_STANDARD_MIN);
            return UI_SCALE_LOW_FONT_PX + (clampNumber(progress, 0, 1) * (UI_SCALE_STANDARD_MAX_FONT_PX - UI_SCALE_LOW_FONT_PX));
        }

        const progress = (safeScale - UI_SCALE_STANDARD_MAX) / (UI_SCALE_MAX - UI_SCALE_STANDARD_MAX);
        return UI_SCALE_STANDARD_MAX_FONT_PX + (clampNumber(progress, 0, 1) * (UI_SCALE_MAX_FONT_PX - UI_SCALE_STANDARD_MAX_FONT_PX));
    }

    function formatUIScaleLabel(scale) {
        const safeScale = clampNumber(Number(scale) || 1, UI_SCALE_MIN, UI_SCALE_MAX);
        return formatPercent(Math.round(safeScale * 100));
    }

    function getUIDensityMode(scale) {
        const safeScale = clampNumber(Number(scale) || 1, UI_SCALE_MIN, UI_SCALE_MAX);
        if (safeScale <= 0.9) return 'compact';
        if (safeScale >= 1.25) return 'relaxed';
        return 'standard';
    }

    function applyUIScale(scale) {
        const safeScale = clampNumber(Number(scale) || 1, UI_SCALE_MIN, UI_SCALE_MAX);
        const fontSizePx = getUIScaleFontSizePx(safeScale);
        const rootFontRem = fontSizePx / 16;
        document.documentElement.style.fontSize = `${rootFontRem}rem`;
        if (document.body) {
            document.body.style.fontSize = '';
            document.body.setAttribute('data-ui-density', getUIDensityMode(safeScale));
        }
        localStorage.setItem('uiScale', safeScale);
        console.log(`UI scale applied: ${safeScale} -> ${fontSizePx}px (${rootFontRem}rem)`);
    }

    // --- Settings Modal ---
    function loadSettings() {
        const defaults = {
            maxSpeed: 0,
            numerateFiles: false,
            skipDuplicates: false,
            removeCompleted: false,
            notificationSound: true,
            notificationPopup: true,
            speedUnitDisplay: 'Mbps',
            downloadFolder: '',
            defaultFormat: 'mp4',
            defaultQuality: 'highest',
            defaultConcurrency: '1',
            playlistConcurrency: '3',
            rememberDownloadChoices: true,
            skipDeleteConfirmation: false,
            themePreset: 'light',
            keepPcAwake: true,
            uiScale: 1.0, // Add UI scale default
            autoUpdateTools: true, // Enable auto-updates by default
            autoCheckUpdates: true, // Look for new app versions on launch and every few hours
            errorTelemetry: false, // Legacy key; mirrors usageStats (default: disabled for privacy)
            usageStats: false, // Opt-in anonymous usage statistics (default: disabled)
            startWithWindows: false, // Start app with Windows (default: disabled)
            supportPopupDisabled: false,
            preferHdr: false,
            subtitleMode: 'none',
            subtitleLanguages: 'en.*,en',
            includeAutoCaptions: false,
            smartRetry: true,
            smartRetryAttempts: 3,
            lanAccess: false,
            language: 'auto'
        };
        const storedSettings = localStorage.getItem('ytdUserSettings');
        let settings = storedSettings ? JSON.parse(storedSettings) : { ...defaults };
        for (const key in defaults) if (settings[key] === undefined) settings[key] = defaults[key];
        if (!normalizeDownloadFolderPath(settings.downloadFolder)) {
            settings.downloadFolder = normalizeDownloadFolderPath(localStorage.getItem('downloadFolder'));
        }
        return settings;
    }

    function saveSettings() {
        // Ensure checkbox is found
        if (!keepPcAwakeCheckbox) {
            keepPcAwakeCheckbox = document.getElementById('keepPcAwake');
        }

        const autoUpdateToolsCheckbox = document.getElementById('autoUpdateTools');
        const usageStatsCheckbox = document.getElementById('usageStats');
        const newUsageStats = usageStatsCheckbox ? usageStatsCheckbox.checked : userSettings.usageStats === true;
        const oldUsageStats = userSettings.usageStats === true;
        const startWithWindowsCheckbox = document.getElementById('startWithWindows');
        const languageSelect = document.getElementById('languageSelect');
        const previousLanguage = userSettings.language || 'auto';

        // Get the new startWithWindows value
        const newStartWithWindows = startWithWindowsCheckbox ? startWithWindowsCheckbox.checked : false;
        const oldStartWithWindows = userSettings.startWithWindows;

        userSettings = {
            // Keep every saved preference this form does not own (main-form pickers, etc.).
            ...userSettings,
            maxSpeed: maxSpeedInput ? (parseInt(maxSpeedInput.value, 10) || 0) : 0,
            numerateFiles: numerateFilesCheckbox ? numerateFilesCheckbox.checked : false,
            skipDuplicates: skipDuplicatesCheckbox ? skipDuplicatesCheckbox.checked : false,
            removeCompleted: removeCompletedCheckbox ? removeCompletedCheckbox.checked : false,
            notificationSound: notificationSoundCheckbox ? notificationSoundCheckbox.checked : true,
            notificationPopup: notificationPopupCheckbox ? notificationPopupCheckbox.checked : true,
            speedUnitDisplay: speedUnitDisplaySelect ? speedUnitDisplaySelect.value : 'Mbps',
            downloadFolder: downloadFolderInput ? downloadFolderInput.value : '',
            defaultFormat: userSettings.defaultFormat || 'mp4',
            defaultQuality: userSettings.defaultQuality || 'highest',
            rememberDownloadChoices: rememberDownloadChoicesCheckbox ? rememberDownloadChoicesCheckbox.checked : userSettings.rememberDownloadChoices !== false,
            skipDeleteConfirmation: skipDeleteConfirmationCheckbox ? skipDeleteConfirmationCheckbox.checked : false,
            themePreset: themePresetSelect ? themePresetSelect.value : 'light',
            keepPcAwake: keepPcAwakeCheckbox ? keepPcAwakeCheckbox.checked : true,
            uiScale: document.getElementById('uiScale') ? parseFloat(document.getElementById('uiScale').value) || 1.0 : 1.0,
            autoUpdateTools: autoUpdateToolsCheckbox ? autoUpdateToolsCheckbox.checked : true,
            autoCheckUpdates: document.getElementById('autoCheckUpdates')
                ? document.getElementById('autoCheckUpdates').checked
                : userSettings.autoCheckUpdates !== false,
            errorTelemetry: newUsageStats,
            usageStats: newUsageStats,
            startWithWindows: newStartWithWindows,
            supportPopupDisabled: userSettings.supportPopupDisabled === true,
            preferHdr: preferHdrCheckbox ? preferHdrCheckbox.checked : false,
            subtitleMode: subtitleModeSelect ? subtitleModeSelect.value : 'none',
            subtitleLanguages: subtitleLanguagesInput ? subtitleLanguagesInput.value.trim() || 'en.*,en' : 'en.*,en',
            includeAutoCaptions: includeAutoCaptionsCheckbox ? includeAutoCaptionsCheckbox.checked : false,
            smartRetry: true,
            smartRetryAttempts: 3,
            lanAccess: userSettings.lanAccess === true,
            language: languageSelect && languageSelect.value ? languageSelect.value : userSettings.language || 'auto'
        };
        persistDownloadFolderPath(userSettings.downloadFolder);

        // Apply theme and UI scale immediately
        applyTheme(userSettings.themePreset);
        applyUIScale(userSettings.uiScale);

        // Sync header speed slider with settings modal value
        const headerSpeedSlider = document.getElementById('headerSpeedSlider');
        const speedValue = document.getElementById('speedValue');
        if (headerSpeedSlider) {
            // Use non-linear mapping (same as in slider widget, min 2 MB/s)
            const speed = userSettings.maxSpeed || 0;
            let sliderVal;
            if (speed === 0) sliderVal = 0;
            else if (speed < 2000) sliderVal = 1;
            else if (speed <= 10000) sliderVal = 1 + Math.round((speed - 2000) / 100);
            else if (speed <= 100000) sliderVal = 80 + Math.round((speed - 10000) / 1125);
            else sliderVal = 160 + Math.round((speed - 100000) / 10000);
            headerSpeedSlider.value = sliderVal;
        }
        if (speedValue) {
            // Format nicely: show MB/s for values >= 1000 KB/s
            const kbps = userSettings.maxSpeed || 0;
            if (kbps === 0) {
                speedValue.textContent = '∞';
            } else if (kbps >= 1000) {
                speedValue.textContent = formatFixed(kbps / 1000, 0) + ' MB/s';
            } else {
                speedValue.textContent = t.formatNumber(kbps) + ' KB/s';
            }
        }

        scheduleAppUpdateChecks();

        // Handle Windows startup toggle if the setting changed
        if (newStartWithWindows !== oldStartWithWindows && window.electronAPI && window.electronAPI.toggleAutoLaunch) {
            window.electronAPI.toggleAutoLaunch(newStartWithWindows)
                .then(result => {
                    if (result.success) {
                        console.log(`Windows startup ${newStartWithWindows ? 'enabled' : 'disabled'}`);
                    } else {
                        console.error('Failed to toggle Windows startup:', result.error);
                    }
                })
                .catch(err => {
                    console.error('Error toggling Windows startup:', err);
                });
        }

        // Send updated auto-update preference to server if WebSocket is connected
        if (ws && ws.readyState === WebSocket.OPEN) {
            const autoUpdateEnabled = userSettings.autoUpdateTools !== false; // Default to true
            sendMessageToServer('auto_update_preference', { enabled: autoUpdateEnabled });
            console.log(`Updated auto-update preference: ${autoUpdateEnabled ? 'enabled' : 'disabled'}`);
        }

        // Update telemetry based on user preference
        if (window.GetVideosLocallyTelemetry) {
            if (userSettings.errorTelemetry) {
                window.GetVideosLocallyTelemetry.enable();
            } else {
                window.GetVideosLocallyTelemetry.disable();
            }
        }

        if (newUsageStats !== oldUsageStats) {
            void setUsageStatsOnServer(newUsageStats);
        }

        if (settingsModal) settingsModal.style.display = 'none';

        const currentStatusDiv = youtubeStatusDiv;
        if (currentStatusDiv) {
            showStatus(t('Settings saved!'), 'youtube', 'success');
        }
        console.log("Settings saved:", userSettings);
        applyLanguageChange(previousLanguage);
    }

    // Fill Settings → Language: "Match my device (…)" first, then every shipped
    // language in its own name, plus its name in the current UI language.
    function populateLanguageSelect() {
        const languageSelect = document.getElementById('languageSelect');
        if (!languageSelect) return;
        const languages = Array.isArray(t.languages) ? t.languages : [];
        const nativeNameOf = (code) => languages.find(language => language.code === code)?.nativeName || code;
        let displayNames = null;
        try {
            displayNames = new Intl.DisplayNames([t.lang], { type: 'language' });
        } catch {
            displayNames = null;
        }

        const autoOption = document.createElement('option');
        autoOption.value = 'auto';
        autoOption.textContent = t('Match my device ({language})', { language: nativeNameOf(t.resolveLanguage('auto')) });

        const languageOptions = languages.map((language) => {
            const option = document.createElement('option');
            option.value = language.code;
            let localName = language.name;
            try {
                localName = displayNames?.of(language.code) || language.name;
            } catch {
                localName = language.name;
            }
            option.textContent = localName && localName !== language.nativeName
                ? `${language.nativeName} — ${localName}`
                : language.nativeName;
            option.lang = language.code;
            option.dir = language.dir;
            return option;
        });

        languageSelect.replaceChildren(autoOption, ...languageOptions);
        const preference = userSettings.language || 'auto';
        languageSelect.value = preference;
        if (languageSelect.value !== preference) languageSelect.value = 'auto';
    }

    // True while anything is queued, downloading, pausing, resuming or being
    // processed. Paused, scheduled and failed items come back from the server
    // after a reload (loadRecoverableDownloads); these would not.
    function hasBusyDownloads() {
        const settledStatuses = new Set(['complete', 'error', 'paused', 'scheduled']);
        return Array.from(downloadItemsState.values()).some(item => !settledStatuses.has(item.status));
    }

    function applyLanguageChange(previousPreference) {
        const preference = userSettings.language || 'auto';
        if (preference === previousPreference) return;
        if (t.resolveLanguage(preference) === t.lang) return;

        saveUserSettingsToStorage();
        if (hasBusyDownloads()) {
            void showAlert(t('The new language will be used the next time you open GetVideosLocally.'), t('Language'));
            return;
        }

        // localStorage is already written; flush it to disk before reloading.
        const flushed = window.electronAPI?.flushStorageData
            ? Promise.resolve(window.electronAPI.flushStorageData()).catch(() => {})
            : Promise.resolve();
        void flushed.then(() => location.reload());
    }

    function populateSettingsModal() {
        void refreshCookieHealth();
        if (!settingsModal) return;

        setSetupHealthSectionVisibility(false);

        // Ensure checkbox is found
        if (!keepPcAwakeCheckbox) {
            keepPcAwakeCheckbox = document.getElementById('keepPcAwake');
        }

        // If still not found, try to create it programmatically
        if (!keepPcAwakeCheckbox) {
            console.log('Creating keepPcAwake checkbox programmatically...');
            // Find the Notifications section by its checkbox, not by its (translated) heading text.
            const notificationPopupInput = document.getElementById('notificationPopup');
            if (notificationPopupInput) {
                const notificationPopupDiv = notificationPopupInput.closest('.setting-item');

                if (notificationPopupDiv) {
                    const newCheckboxDiv = document.createElement('div');
                    newCheckboxDiv.className = 'setting-item checkbox-group';
                    newCheckboxDiv.innerHTML = `
                        <input type="checkbox" id="keepPcAwake" name="keepPcAwake">
                        <label for="keepPcAwake">${escapeHtml(t('Keep PC awake during downloads'))}</label>
                    `;

                    // Insert after notificationPopup
                    notificationPopupDiv.parentNode.insertBefore(newCheckboxDiv, notificationPopupDiv.nextSibling);

                    // Update the reference
                    keepPcAwakeCheckbox = document.getElementById('keepPcAwake');
                    console.log('Checkbox created and reference updated:', keepPcAwakeCheckbox);
                }
            }
        }

        const autoUpdateToolsCheckbox = document.getElementById('autoUpdateTools');
        if (maxSpeedInput) maxSpeedInput.value = userSettings.maxSpeed;
        if (numerateFilesCheckbox) numerateFilesCheckbox.checked = userSettings.numerateFiles;
        if (skipDuplicatesCheckbox) skipDuplicatesCheckbox.checked = userSettings.skipDuplicates;
        if (rememberDownloadChoicesCheckbox) rememberDownloadChoicesCheckbox.checked = userSettings.rememberDownloadChoices !== false;
        if (removeCompletedCheckbox) removeCompletedCheckbox.checked = userSettings.removeCompleted;
        if (notificationSoundCheckbox) notificationSoundCheckbox.checked = userSettings.notificationSound;
        if (notificationPopupCheckbox) notificationPopupCheckbox.checked = userSettings.notificationPopup;
        if (keepPcAwakeCheckbox) keepPcAwakeCheckbox.checked = userSettings.keepPcAwake;
        if (autoUpdateToolsCheckbox) autoUpdateToolsCheckbox.checked = userSettings.autoUpdateTools !== false; // Default to true
        const autoCheckUpdatesCheckbox = document.getElementById('autoCheckUpdates');
        if (autoCheckUpdatesCheckbox) autoCheckUpdatesCheckbox.checked = userSettings.autoCheckUpdates !== false;
        void refreshAboutPanel();
        const usageStatsCheckbox = document.getElementById('usageStats');
        if (usageStatsCheckbox) usageStatsCheckbox.checked = userSettings.usageStats === true;
        void reconcileUsageStats();
        if (speedUnitDisplaySelect) speedUnitDisplaySelect.value = userSettings.speedUnitDisplay;
        if (downloadFolderInput) downloadFolderInput.value = userSettings.downloadFolder || '';
        if (skipDeleteConfirmationCheckbox) skipDeleteConfirmationCheckbox.checked = userSettings.skipDeleteConfirmation;
        if (themePresetSelect) themePresetSelect.value = userSettings.themePreset;
        populateLanguageSelect();
        if (preferHdrCheckbox) preferHdrCheckbox.checked = userSettings.preferHdr === true;
        if (subtitleModeSelect) subtitleModeSelect.value = userSettings.subtitleMode || 'none';
        if (subtitleLanguagesInput) subtitleLanguagesInput.value = userSettings.subtitleLanguages || 'en.*,en';
        if (includeAutoCaptionsCheckbox) includeAutoCaptionsCheckbox.checked = userSettings.includeAutoCaptions === true;
        updateSubtitleVisibility();

        // Handle Windows startup checkbox - fetch actual state from system
        const startWithWindowsCheckbox = document.getElementById('startWithWindows');
        if (startWithWindowsCheckbox) {
            // First set to saved value, then update with actual system state
            startWithWindowsCheckbox.checked = userSettings.startWithWindows === true;

            // Async update from system state (if running in Electron)
            if (window.electronAPI && window.electronAPI.getAutoLaunchStatus) {
                window.electronAPI.getAutoLaunchStatus()
                    .then(result => {
                        if (result.success) {
                            startWithWindowsCheckbox.checked = result.enabled;
                            // Sync settings with actual system state
                            if (userSettings.startWithWindows !== result.enabled) {
                                userSettings.startWithWindows = result.enabled;
                                saveUserSettingsToStorage();
                            }
                        }
                    })
                    .catch(err => {
                        console.error('Error getting auto-launch status:', err);
                    });
            }
        }

        const lanAccessCheckbox = document.getElementById('lanAccess');
        if (lanAccessCheckbox) {
            lanAccessCheckbox.checked = userSettings.lanAccess === true;

            if (window.electronAPI && window.electronAPI.getFirewallAccessStatus) {
                window.electronAPI.getFirewallAccessStatus()
                    .then(result => {
                        if (result && result.exists !== undefined) {
                            lanAccessCheckbox.checked = result.exists;
                            userSettings.lanAccess = result.exists;
                            saveUserSettingsToStorage();
                            window.userSettings = userSettings;
                        }
                    })
                    .catch(err => {
                        console.error('Error getting firewall status:', err);
                    });
            }

            lanAccessCheckbox.onchange = async () => {
                if (!window.electronAPI) return;
                const enable = lanAccessCheckbox.checked;
                lanAccessCheckbox.disabled = true;
                try {
                    const result = enable
                        ? await window.electronAPI.enableFirewallAccess()
                        : await window.electronAPI.disableFirewallAccess();

                    if (result && result.success) {
                        userSettings.lanAccess = enable;
                        saveUserSettingsToStorage();
                        window.userSettings = userSettings;
                    } else {
                        lanAccessCheckbox.checked = !enable;
                        if (!result?.userDenied) {
                            console.error('Firewall toggle failed:', result?.error);
                        }
                    }
                } catch (err) {
                    lanAccessCheckbox.checked = !enable;
                    console.error('Error toggling firewall rule:', err);
                } finally {
                    lanAccessCheckbox.disabled = false;
                }
            };
        }

        // Add UI scale
        const uiScaleInput = document.getElementById('uiScale');
        const uiScaleValue = document.getElementById('uiScaleValue');
        if (uiScaleInput) {
            uiScaleInput.value = userSettings.uiScale || 1.0;
            if (uiScaleValue) uiScaleValue.textContent = formatUIScaleLabel(userSettings.uiScale || 1.0);
        }

        applyUIScale(userSettings.uiScale || 1.0);

        if (latestSetupHealthResult) {
            renderSetupHealthResult(latestSetupHealthResult);
        } else {
            renderSetupHealthLoading(t('Run the setup health check to verify your local downloader setup.'));
        }
    }

    if (settingsBtn) {
        settingsBtn.onclick = () => {
            populateSettingsModal();
            if (settingsModal) {
                openModalWithFocus(settingsModal, closeSettingsBtn || saveSettingsBtn);
            }
        };
    }
    if (closeSettingsBtn) {
        closeSettingsBtn.onclick = () => {
            if (settingsModal) {
                closeModalWithFocusRestore(settingsModal);
            }
        };
    }
    if (saveSettingsBtn) {
        saveSettingsBtn.onclick = saveSettings;
    }

    // --- Settings sidebar tabs ---
    function activateSettingsTab(tabName) {
        const tabs = Array.from(document.querySelectorAll('.settings-nav-item'));
        const target = tabs.find(tab => tab.dataset.settingsTab === tabName);
        if (!target) return;
        tabs.forEach(tab => {
            const isActive = tab === target;
            tab.classList.toggle('active', isActive);
            tab.setAttribute('aria-selected', String(isActive));
            tab.tabIndex = isActive ? 0 : -1;
        });
        document.querySelectorAll('.settings-panel').forEach(panel => {
            panel.hidden = panel.dataset.settingsPanel !== tabName;
        });
        const panelsContainer = document.querySelector('.settings-panels');
        if (panelsContainer) panelsContainer.scrollTop = 0;
    }

    document.querySelectorAll('.settings-nav-item').forEach((tab, index, allTabs) => {
        tab.addEventListener('click', () => activateSettingsTab(tab.dataset.settingsTab));
        tab.addEventListener('keydown', (event) => {
            const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
            if (!step) return;
            event.preventDefault();
            const next = allTabs[(index + step + allTabs.length) % allTabs.length];
            activateSettingsTab(next.dataset.settingsTab);
            next.focus();
        });
    });

    // --- About tab & in-app updates ---
    const appUpdateBtn = document.getElementById('appUpdateBtn');
    const checkAppUpdateBtn = document.getElementById('checkAppUpdateBtn');
    const APP_UPDATE_FIRST_CHECK_MS = 15000;
    const APP_UPDATE_INTERVAL_MS = 4 * 60 * 60 * 1000;
    let appUpdateState = null;
    let appUpdateTimer = null;
    let appUpdateReadyAnnounced = null;

    function formatUpdateCheckedTime(timestamp) {
        if (!timestamp) return '';
        const minutes = Math.round((Date.now() - timestamp) / 60000);
        if (minutes < 1) return t('Checked just now');
        if (minutes < 60) return t.plural(minutes, 'Checked {count} min ago', 'Checked {count} min ago');
        return t('Checked at {time}', { time: t.formatDate(new Date(timestamp), { hour: 'numeric', minute: '2-digit' }) });
    }

    function describeAppUpdate(state) {
        const version = state.latestVersion;
        switch (state.status) {
            case 'checking':
                return { title: t('Checking for updates…'), desc: t('This only takes a moment'), button: t('Checking…'), busy: true };
            case 'up-to-date':
                return { title: t("You're up to date"), desc: formatUpdateCheckedTime(state.lastChecked), button: t('Check now') };
            case 'downloading':
                return {
                    title: version ? t('Getting version {version}', { version }) : t('Getting a new version'),
                    desc: t('{percent} · You can keep using the app', { percent: formatPercent(state.progress || 0) }),
                    button: t('Downloading…'),
                    busy: true
                };
            case 'ready':
                return { title: version ? t('Version {version} is ready', { version }) : t('A new version is ready'), desc: t('Restart to finish. Your settings and history stay the same.'), button: t('Restart to update'), action: true };
            case 'available-manual':
                return { title: version ? t('Version {version} is available', { version }) : t('A new version is available'), desc: t('This is the portable copy, so download the new version from the website.'), button: t('Get update'), action: true };
            case 'error':
                return { title: t('Check for updates'), desc: serverError(state, t("Couldn't check for updates. Try again later.")), button: t('Try again') };
            default:
                return { title: t('Check for updates'), desc: t('Not checked yet'), button: t('Check now') };
        }
    }

    function renderAppUpdateState(state) {
        if (!state) return;
        appUpdateState = state;
        const view = describeAppUpdate(state);

        if (appUpdateBtn) {
            appUpdateBtn.hidden = !view.action;
            const label = appUpdateBtn.querySelector('.app-update-btn-text');
            if (label) label.textContent = view.button;
            appUpdateBtn.title = view.action ? t('{title}. {description}', { title: view.title, description: view.desc }) : '';
            appUpdateBtn.setAttribute('aria-label', view.action ? t('{action}: {title}', { action: view.button, title: view.title }) : view.button);
        }

        const title = document.getElementById('aboutUpdateTitle');
        const desc = document.getElementById('aboutUpdateStatus');
        if (title) title.textContent = view.title;
        if (desc) desc.textContent = view.desc;
        if (checkAppUpdateBtn) {
            checkAppUpdateBtn.disabled = view.busy === true;
            checkAppUpdateBtn.classList.toggle('primary', view.action === true);
            checkAppUpdateBtn.classList.toggle('secondary', view.action !== true);
            const label = checkAppUpdateBtn.querySelector('.check-app-update-label');
            if (label) label.textContent = view.button;
        }
        const progress = document.getElementById('aboutUpdateProgress');
        const progressFill = document.getElementById('aboutUpdateProgressFill');
        if (progress) progress.hidden = state.status !== 'downloading';
        if (progressFill) progressFill.style.width = `${Math.max(0, Math.min(100, state.progress || 0))}%`;

        if (state.status === 'ready' && appUpdateReadyAnnounced !== state.latestVersion) {
            appUpdateReadyAnnounced = state.latestVersion;
            showNotification(t('{title}. Click "Restart to update" at the top when you\'re ready.', { title: view.title }), 'success');
        }
    }

    async function checkForAppUpdate() {
        if (!window.electronAPI?.checkForAppUpdate) return;
        try {
            renderAppUpdateState(await window.electronAPI.checkForAppUpdate());
        } catch (error) {
            console.warn('App update check failed:', error);
        }
    }

    async function installAppUpdate() {
        const state = appUpdateState;
        if (state?.status === 'available-manual') {
            window.open(state.downloadUrl || 'https://getvideoslocally.com/#download', '_blank', 'noopener');
            return;
        }
        if (!window.electronAPI?.installAppUpdate) return;
        const result = await window.electronAPI.installAppUpdate();
        if (result?.ok) {
            showNotification(t('Restarting to finish the update…'), 'info');
        } else if (result?.reason === 'downloads-active') {
            showNotification(t('Downloads are still running. Restart to update once they finish, or the update will install the next time you close the app.'), 'warning');
        }
    }

    function scheduleAppUpdateChecks() {
        if (userSettings.autoCheckUpdates === false) {
            window.clearTimeout(appUpdateTimer);
            appUpdateTimer = null;
            return;
        }
        if (appUpdateTimer) return;
        const run = () => {
            void checkForAppUpdate();
            appUpdateTimer = window.setTimeout(run, APP_UPDATE_INTERVAL_MS);
        };
        appUpdateTimer = window.setTimeout(run, APP_UPDATE_FIRST_CHECK_MS);
    }

    async function refreshAboutPanel() {
        const setText = (id, value) => {
            const element = document.getElementById(id);
            if (element) element.textContent = value || '—';
        };
        setText('aboutVersion', document.documentElement.dataset.appVersion);
        try {
            const info = await window.electronAPI?.getAppInfo?.();
            if (info) {
                setText('aboutVersion', info.version);
                setText('aboutEdition', info.edition);
                setText('aboutElectron', info.electron);
                setText('aboutDataPath', info.userDataPath);
                const dataPath = document.getElementById('aboutDataPath');
                if (dataPath) dataPath.title = info.userDataPath || '';
            }
        } catch (error) {
            console.warn('Could not read app info:', error);
        }
        try {
            const response = await window.localApiAuth.authorizedFetch('/tools-status');
            const tools = await response.json();
            setText('aboutYtdlp', tools?.ytdlp?.version);
            // FFmpeg reports a whole banner ("ffmpeg version 9.0.2-essentials_build-… Copyright …").
            const ffmpegVersion = String(tools?.ffmpeg?.version || '')
                .replace(/^ffmpeg version\s+/i, '')
                .split(/\s/)[0]
                .replace(/-(essentials|full)_build.*$/i, '');
            setText('aboutFfmpeg', ffmpegVersion);
        } catch (_) {
            // Tools status is informational; leave the dashes.
        }
        try {
            renderAppUpdateState(await window.electronAPI?.getAppUpdateState?.());
        } catch (_) {
            // Not running inside the desktop app.
        }
    }

    appUpdateBtn?.addEventListener('click', () => void installAppUpdate());
    checkAppUpdateBtn?.addEventListener('click', () => {
        if (appUpdateState?.status === 'ready' || appUpdateState?.status === 'available-manual') {
            void installAppUpdate();
        } else {
            void checkForAppUpdate();
        }
    });
    window.electronAPI?.onAppUpdateStatus?.(renderAppUpdateState);
    window.electronAPI?.getAppUpdateState?.().then(renderAppUpdateState).catch(() => {});
    scheduleAppUpdateChecks();

    // Subtitle mode toggle: hide languages & auto-captions when set to "none"
    function updateSubtitleVisibility() {
        const mode = subtitleModeSelect ? subtitleModeSelect.value : 'none';
        const langGroup = document.getElementById('subtitleLanguagesGroup');
        const autoGroup = document.getElementById('autoCaptionsGroup');
        if (langGroup) langGroup.classList.toggle('is-hidden-initial', mode === 'none');
        if (autoGroup) autoGroup.classList.toggle('is-hidden-initial', mode === 'none');
    }
    if (subtitleModeSelect) {
        subtitleModeSelect.addEventListener('change', updateSubtitleVisibility);
        updateSubtitleVisibility();
    }

    // Setup Guide button
    const openTutorialBtn = document.getElementById('openTutorialBtn');
    if (openTutorialBtn) {
        openTutorialBtn.onclick = () => {
            if (settingsModal) settingsModal.style.display = 'none';
            if (window.openOnboarding) {
                window.openOnboarding();
            }
        };
    }

    // Update tools button
    const updateToolsBtn = document.getElementById('updateToolsBtn');
    const updateStatusMessage = document.getElementById('updateToolsStatus');

    function showUpdateStatus(message, type) {
        if (!updateStatusMessage) return;
        if (!message) {
            updateStatusMessage.textContent = '';
            updateStatusMessage.className = 'status-message with-margin is-hidden-initial';
            updateStatusMessage.style.display = 'none';
            return;
        }
        updateStatusMessage.textContent = message;
        updateStatusMessage.className = `status-message with-margin ${type || ''}`;
        updateStatusMessage.style.display = 'flex';

        if (type === 'success') {
            setTimeout(() => {
                showUpdateStatus('', '');
            }, 5000);
        }
    }

    showUpdateStatus('', '');

    if (updateToolsBtn) {
        updateToolsBtn.onclick = async () => {
            try {
                updateToolsBtn.disabled = true;
                updateToolsBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${escapeHtml(t('Checking...'))}`;
                showUpdateStatus(t('Checking for updates...'), '');

                const result = await window.updateTools();

                if (result && result.deferred) {
                    const count = result.waitingFor || 1;
                    showUpdateStatus(result.tool
                        ? t.plural(count, '{tool} update downloaded and verified. It installs after the running download finishes; new downloads wait for it.', '{tool} update downloaded and verified. It installs after the {count} running downloads finish; new downloads wait for it.', { tool: result.tool })
                        : t.plural(count, 'Tool update downloaded and verified. It installs after the running download finishes; new downloads wait for it.', 'Tool update downloaded and verified. It installs after the {count} running downloads finish; new downloads wait for it.'), 'success');
                    return;
                }

                if (result && result.error) {
                    showUpdateStatus(t('Error: {error}', { error: serverError(result) }), 'error');
                    updateToolsBtn.disabled = false;
                    updateToolsBtn.innerHTML = `<i class="fas fa-download"></i> ${escapeHtml(t('Update Tools'))}`;
                    return;
                }

                if (result) {
                    let message = '';
                    let hasUpdates = false;
                    let hasErrors = false;

                    // Check yt-dlp results
                    if (result.ytdlp) {
                        if (result.ytdlp.updated) {
                            message += `✅ ${t('yt-dlp updated: {oldVersion} → {newVersion}', { oldVersion: result.ytdlp.oldVersion, newVersion: result.ytdlp.newVersion })}\n`;
                            hasUpdates = true;
                        } else if (result.ytdlp.error) {
                            message += `❌ ${t('yt-dlp update failed: {error}', { error: serverError(result.ytdlp) })}\n`;
                            hasErrors = true;
                        } else {
                            message += `ℹ️ ${t('yt-dlp: {reason}', { reason: serverReason(result.ytdlp, t('No update available')) })}\n`;
                        }
                    }

                    // Check FFmpeg results
                    if (result.ffmpeg) {
                        if (result.ffmpeg.updated) {
                            message += `✅ ${t('FFmpeg updated: {oldVersion} → {newVersion}', { oldVersion: result.ffmpeg.oldVersion, newVersion: result.ffmpeg.newVersion })}\n`;
                            hasUpdates = true;
                        } else if (result.ffmpeg.hasUpdate) {
                            message += `🔄 ${t('FFmpeg {version} is available but could not be installed: {reason}', { version: result.ffmpeg.latestVersion, reason: serverReason(result.ffmpeg, t('unknown error')) })}\n`;
                            hasErrors = true;
                        } else if (result.ffmpeg.error) {
                            message += `❌ ${t('FFmpeg check failed: {error}', { error: serverError(result.ffmpeg) })}\n`;
                            hasErrors = true;
                        } else {
                            message += `ℹ️ ${t('FFmpeg: {reason}', { reason: serverReason(result.ffmpeg, t('No update available')) })}\n`;
                        }
                    }

                    if (hasUpdates) {
                        showUpdateStatus(message.trim(), 'success');
                    } else if (hasErrors) {
                        showUpdateStatus(message.trim(), 'error');
                    } else {
                        showUpdateStatus(message.trim() || t('All tools are up to date.'), '');
                    }
                } else {
                    showUpdateStatus(t('Unable to check for updates. Please try again.'), 'error');
                }
            } catch (error) {
                console.error('Error updating tools:', error);
                showUpdateStatus(t('Error: {error}', { error: error.message || t('Failed to update tools. Please try again.') }), 'error');
            } finally {
                updateToolsBtn.disabled = false;
                updateToolsBtn.innerHTML = `<i class="fas fa-download"></i> ${escapeHtml(t('Update Tools'))}`;
            }
        };
    }

    // Diagnostics: the same report backs "Generate" and "Report a problem".
    function localApiUrl(pathname) {
        const serverPort = ws?.url?.match(/:(\d+)/)?.[1] || '9875';
        return `http://127.0.0.1:${serverPort}${pathname}`;
    }

    function buildDiagnosticsContext() {
        const wsStates = ['connecting', 'open', 'closing', 'closed'];
        return {
            settings: userSettings,
            renderer: {
                viewport: `${window.innerWidth}x${window.innerHeight}`,
                devicePixelRatio: window.devicePixelRatio,
                online: navigator.onLine,
                userAgent: navigator.userAgent,
                websocketState: ws ? wsStates[ws.readyState] : 'not created',
                activeTab: activeDownloader,
                errors: diagnosticsErrorLog,
            },
        };
    }

    async function downloadDiagnosticsFile() {
        const response = await window.localApiAuth.authorizedFetch(localApiUrl('/diagnostics'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildDiagnosticsContext()),
        });
        if (!response.ok) {
            throw new Error(t('Failed to generate diagnostics: {error}', { error: response.statusText }));
        }
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `diagnostics-${Date.now()}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    }

    const generateDiagnosticsBtn = document.getElementById('generateDiagnosticsBtn');
    if (generateDiagnosticsBtn) {
        const generateDiagnosticsLabel = generateDiagnosticsBtn.innerHTML;
        generateDiagnosticsBtn.onclick = async () => {
            try {
                generateDiagnosticsBtn.disabled = true;
                generateDiagnosticsBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${escapeHtml(t('Generating...'))}`;
                await downloadDiagnosticsFile();
                showStatus(t('Diagnostics bundle downloaded successfully!'), activeDownloader, 'success');
            } catch (error) {
                console.error('Error generating diagnostics:', error);
                showStatus(t('Failed to generate diagnostics: {error}', { error: error.message }), activeDownloader, 'error');
            } finally {
                generateDiagnosticsBtn.disabled = false;
                generateDiagnosticsBtn.innerHTML = generateDiagnosticsLabel;
            }
        };
    }

    // --- Report a problem ---
    const reportProblemModal = document.getElementById('reportProblemModal');
    const reportProblemForm = document.getElementById('reportProblemForm');
    const reportProblemMessage = document.getElementById('reportProblemMessage');
    const reportProblemEmail = document.getElementById('reportProblemEmail');
    const reportProblemIncludeDiagnostics = document.getElementById('reportProblemIncludeDiagnostics');
    const reportProblemStatus = document.getElementById('reportProblemStatus');
    const sendReportProblemBtn = document.getElementById('sendReportProblemBtn');
    const cancelReportProblemBtn = document.getElementById('cancelReportProblemBtn');
    const REPORT_EMAIL_KEY = 'gvl.reportEmail';
    let reportProblemSending = false;

    function setReportStatus(text, tone = '') {
        if (!reportProblemStatus) return;
        reportProblemStatus.textContent = text;
        if (tone) reportProblemStatus.dataset.tone = tone;
        else delete reportProblemStatus.dataset.tone;
    }

    // Consent is asked per report: the attachment box always starts unticked.
    function openReportProblem({ message = '' } = {}) {
        if (!reportProblemModal || !reportProblemForm) return;
        reportProblemForm.classList.remove('is-sent');
        reportProblemMessage.value = message;
        reportProblemEmail.value = localStorage.getItem(REPORT_EMAIL_KEY) || '';
        reportProblemIncludeDiagnostics.checked = false;
        if (cancelReportProblemBtn) cancelReportProblemBtn.textContent = t('Cancel');
        setReportStatus('');
        openModalWithFocus(reportProblemModal, reportProblemMessage);
        if (message) {
            window.setTimeout(() => reportProblemMessage.setSelectionRange(message.length, message.length), 0);
        }
    }

    function closeReportProblem() {
        if (!reportProblemModal || reportProblemSending) return;
        closeModalWithFocusRestore(reportProblemModal);
        // The settings modal underneath still needs the scroll lock.
        const settingsModalElement = document.getElementById('settingsModal');
        if (settingsModalElement && settingsModalElement.style.display === 'flex') {
            document.body.classList.add('modal-open');
        }
    }

    if (reportProblemModal && reportProblemForm) {
        document.getElementById('reportProblemBtn')?.addEventListener('click', () => openReportProblem());
        document.getElementById('aboutReportProblemBtn')?.addEventListener('click', () => openReportProblem());
        document.getElementById('closeReportProblemBtn')?.addEventListener('click', closeReportProblem);
        cancelReportProblemBtn?.addEventListener('click', closeReportProblem);
        reportProblemModal.addEventListener('click', (event) => {
            if (event.target === reportProblemModal) closeReportProblem();
        });
        // Capture phase, so Escape closes only this dialog and not settings too.
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && reportProblemModal.style.display === 'flex') {
                event.stopPropagation();
                closeReportProblem();
            }
        }, true);

        document.getElementById('reportProblemPreviewBtn')?.addEventListener('click', async () => {
            setReportStatus(t('Building the diagnostics report...'));
            try {
                await downloadDiagnosticsFile();
                setReportStatus(t('A copy was saved to your downloads. This is exactly what gets attached.'), 'ok');
            } catch (error) {
                setReportStatus(error.message, 'bad');
            }
        });

        reportProblemForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (reportProblemSending) return;
            const message = reportProblemMessage.value.trim();
            const email = reportProblemEmail.value.trim();
            if (!message) {
                setReportStatus(t('Describe what went wrong first.'), 'bad');
                reportProblemMessage.focus();
                return;
            }
            if (email && !reportProblemEmail.checkValidity()) {
                setReportStatus(t('That email address does not look right. Fix it or leave it empty.'), 'bad');
                reportProblemEmail.focus();
                return;
            }

            const includeDiagnostics = reportProblemIncludeDiagnostics.checked;
            const originalLabel = sendReportProblemBtn.innerHTML;
            reportProblemSending = true;
            sendReportProblemBtn.disabled = true;
            sendReportProblemBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${escapeHtml(t('Sending...'))}`;
            setReportStatus(includeDiagnostics ? t('Building the diagnostics report and sending...') : t('Sending...'));
            try {
                const response = await window.localApiAuth.authorizedFetch(localApiUrl('/api/report-problem'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        message,
                        email,
                        includeDiagnostics,
                        ...(includeDiagnostics ? buildDiagnosticsContext() : {}),
                    }),
                });
                const result = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(serverError(result, t('The report could not be sent (HTTP {status}).', { status: response.status })));
                if (email) localStorage.setItem(REPORT_EMAIL_KEY, email);
                else localStorage.removeItem(REPORT_EMAIL_KEY);
                reportProblemForm.classList.add('is-sent');
                if (cancelReportProblemBtn) cancelReportProblemBtn.textContent = t('Close');
                let sentText;
                if (result.diagnosticsIncluded) {
                    sentText = email
                        ? t('Report and diagnostics sent. Replies go to {email}.', { email })
                        : t('Report and diagnostics sent. Thanks for telling us.');
                } else {
                    sentText = email
                        ? t('Report sent. Replies go to {email}.', { email })
                        : t('Report sent. Thanks for telling us.');
                }
                setReportStatus(sentText, 'ok');
            } catch (error) {
                setReportStatus(error.message, 'bad');
            } finally {
                reportProblemSending = false;
                sendReportProblemBtn.disabled = false;
                sendReportProblemBtn.innerHTML = originalLabel;
            }
        });
    }

    if (dismissFailureHelpBtn) {
        dismissFailureHelpBtn.onclick = () => hideFailureHelp({ dismissed: true });
    }

    if (failureHelpPrimaryBtn) {
        failureHelpPrimaryBtn.onclick = () => {
            if (typeof failureHelpActionHandler === 'function') {
                failureHelpActionHandler();
            }
        };
    }

    if (runHealthCheckBtn) {
        runHealthCheckBtn.onclick = () => runSetupHealthCheck({ announce: true });
    }

    if (toggleHealthCheckBtn) {
        toggleHealthCheckBtn.onchange = async () => {
            if (!setupHealthSection) return;

            const willShow = toggleHealthCheckBtn.checked;
            setSetupHealthSectionVisibility(willShow);

            if (willShow) {
                await runSetupHealthCheck({ announce: true });
                setupHealthSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        };
    }

    // Reset speed button
    if (resetSpeedBtn) {
        resetSpeedBtn.onclick = () => {
            if (maxSpeedInput) maxSpeedInput.value = '0';
        };
    }

    window.onclick = (event) => {
        if (settingsModal && event.target === settingsModal) {
            closeModalWithFocusRestore(settingsModal);
        }
    };

    // --- Notifications ---
    function playNotificationSound() {
        if (completionSound) completionSound.play().catch(e => console.warn("Error playing notification sound:", e));
    }
    function showDesktopNotification(title, body) {
        if (!("Notification" in window)) {
            console.log("This browser does not support desktop notification");
            return;
        }
        if (Notification.permission === "granted") {
            new Notification(title, { body: body, icon: './assets/Logo 1.png' });
        } else if (Notification.permission !== "denied") {
            Notification.requestPermission().then(function (permission) {
                if (permission === "granted") {
                    new Notification(title, { body: body, icon: './assets/Logo 1.png' });
                }
            });
        }
    }
    if (("Notification" in window) && Notification.permission !== "granted" && Notification.permission !== "denied") {
        Notification.requestPermission();
    }

    // --- Helper Functions ---
    function shouldSkipDeleteConfirmation() {
        return userSettings.skipDeleteConfirmation === true;
    }

    // Aceternity UI Custom Confirmation Modal
    function confirmDelete(message, title = t('Confirm Deletion')) {
        if (shouldSkipDeleteConfirmation()) {
            return true;
        }

        return new Promise((resolve) => {
            const modal = document.getElementById('confirmationModal');
            const messageEl = document.getElementById('confirmationMessage');
            const titleEl = document.getElementById('confirmationTitle');
            const confirmBtn = document.getElementById('confirmationConfirmBtn');
            const cancelBtn = document.getElementById('confirmationCancelBtn');

            // Set content
            titleEl.textContent = title;
            messageEl.textContent = message;

            // Remove existing listeners
            const newConfirmBtn = confirmBtn.cloneNode(true);
            const newCancelBtn = cancelBtn.cloneNode(true);
            confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
            cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

            // Show modal
            openModalWithFocus(modal, newConfirmBtn);

            // Add new listeners
            newConfirmBtn.addEventListener('click', () => {
                closeModalWithFocusRestore(modal);
                resolve(true);
            });

            newCancelBtn.addEventListener('click', () => {
                closeModalWithFocusRestore(modal);
                resolve(false);
            });

            // Close on backdrop click
            modal.addEventListener('click', function backdropClick(e) {
                if (e.target === modal) {
                    closeModalWithFocusRestore(modal);
                    modal.removeEventListener('click', backdropClick);
                    resolve(false);
                }
            });

            // Close on Escape key
            const escapeHandler = (e) => {
                if (e.key === 'Escape') {
                    closeModalWithFocusRestore(modal);
                    document.removeEventListener('keydown', escapeHandler);
                    resolve(false);
                }
            };
            document.addEventListener('keydown', escapeHandler);
        });
    }

    // Aceternity UI Custom Alert Modal
    function showAlert(message, title = t('Notification')) {
        return new Promise((resolve) => {
            const modal = document.getElementById('alertModal');
            const messageEl = document.getElementById('alertMessage');
            const titleEl = document.getElementById('alertTitle');
            const okBtn = document.getElementById('alertCloseBtn');

            // Set content
            titleEl.textContent = title;
            messageEl.textContent = message;

            // Remove existing listeners
            const newOkBtn = okBtn.cloneNode(true);
            okBtn.parentNode.replaceChild(newOkBtn, okBtn);

            // Show modal
            openModalWithFocus(modal, newOkBtn);

            // Add new listener
            newOkBtn.addEventListener('click', () => {
                closeModalWithFocusRestore(modal);
                resolve();
            });

            // Close on backdrop click
            modal.addEventListener('click', function backdropClick(e) {
                if (e.target === modal) {
                    closeModalWithFocusRestore(modal);
                    modal.removeEventListener('click', backdropClick);
                    resolve();
                }
            });

            // Close on Escape key
            const escapeHandler = (e) => {
                if (e.key === 'Escape') {
                    closeModalWithFocusRestore(modal);
                    document.removeEventListener('keydown', escapeHandler);
                    resolve();
                }
            };
            document.addEventListener('keydown', escapeHandler);
        });
    }

    function markSupportPopupShownForCurrentVersion() {
        localStorage.setItem(SUPPORT_POPUP_LAST_VERSION_KEY, getCurrentAppVersion());
    }

    function hasSupportPopupBeenShownForCurrentVersion() {
        return localStorage.getItem(SUPPORT_POPUP_LAST_VERSION_KEY) === getCurrentAppVersion();
    }

    function closeSupportPopup() {
        if (!supportModal) return;
        closeModalWithFocusRestore(supportModal);
    }

    function showSupportPopupIfEligible() {
        if (!supportModal) return;
        if (userSettings.supportPopupDisabled === true) return;
        if (hasSupportPopupBeenShownForCurrentVersion()) return;

        markSupportPopupShownForCurrentVersion();
        openModalWithFocus(supportModal, supportModalDonateBtn || closeSupportModalBtn);
    }

    if (supportModal) {
        if (closeSupportModalBtn) {
            closeSupportModalBtn.addEventListener('click', closeSupportPopup);
        }

        if (supportModalDismissBtn) {
            supportModalDismissBtn.addEventListener('click', closeSupportPopup);
        }

        if (supportModalDonateBtn) {
            supportModalDonateBtn.addEventListener('click', () => {
                window.open(SUPPORT_DONATION_URL, '_blank', 'noopener,noreferrer');
                closeSupportPopup();
            });
        }

        if (supportModalNeverBtn) {
            supportModalNeverBtn.addEventListener('click', () => {
                userSettings.supportPopupDisabled = true;
                saveUserSettingsToStorage();
                window.userSettings = userSettings;
                closeSupportPopup();
            });
        }

        supportModal.addEventListener('click', (event) => {
            if (event.target === supportModal) {
                closeSupportPopup();
            }
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && supportModal.style.display === 'flex') {
                closeSupportPopup();
            }
        });
    }

    if (playlistSelectionModal) {
        const closeSelection = () => closePlaylistSelectionFlow();
        closePlaylistSelectionBtn?.addEventListener('click', closeSelection);
        cancelPlaylistSelectionBtn?.addEventListener('click', closeSelection);
        playlistSelectAllBtn?.addEventListener('click', () => {
            const checkboxes = Array.from(playlistSelectionList?.querySelectorAll('input[type="checkbox"]') || []);
            const selectAll = checkboxes.some((checkbox) => !checkbox.checked);
            checkboxes.forEach((checkbox) => {
                checkbox.checked = selectAll;
            });
            updatePlaylistSelectionState();
        });
        playlistSelectionList?.addEventListener('change', updatePlaylistSelectionState);
        confirmPlaylistSelectionBtn?.addEventListener('click', async () => {
            if (!pendingPlaylistSelectionRequest) {
                closePlaylistSelectionFlow();
                return;
            }
            const selectedIds = getSelectedPlaylistItemIds();
            if (selectedIds.length === 0) {
                showStatus(t('Select at least one playlist item before queueing.'), 'youtube', 'error');
                return;
            }
            const request = pendingPlaylistSelectionRequest;
            closePlaylistSelectionFlow();
            try {
                await startDownloadCommon(
                    request.url,
                    request.format,
                    request.quality,
                    request.source,
                    request.playlistAction,
                    request.concurrency,
                    request.singleConcurrency,
                    {
                        selectedPlaylistItems: selectedIds,
                        preferHdr: request.preferHdr
                    }
                );
            } catch (error) {
                showStatus(t('Could not queue selected playlist items: {error}', { error: error.displayMessage || error.message }), 'youtube', 'error');
            }
        });
        playlistSelectionModal.addEventListener('click', (event) => {
            if (event.target === playlistSelectionModal) {
                closeSelection();
            }
        });
    }

    // --- Logo Click Handler ---
    const logoContainer = document.querySelector('.logo-container');
    if (logoContainer) {
        logoContainer.style.cursor = 'pointer';
        const activateLogo = () => {
            showTab('youtube');
        };
        logoContainer.addEventListener('click', activateLogo);
        makeElementKeyboardClickable(logoContainer, activateLogo, t('Open downloads'));
    }

    // --- Initializations ---
    applyTheme(userSettings.themePreset || 'light');
    applyUIScale(userSettings.uiScale || 1.0); // Add this line

    if (document.getElementById('youtubeDownloader')) {
        showTab(activeDownloader);
        void loadRecoverableDownloads();
        void reconcileUsageStats();
    } else if (contactUsTab) {
        showTab('youtube');
    }

    // Ensure DOM is fully loaded before populating settings
    setTimeout(() => {
        // Re-find elements in case they weren't available initially
        if (!keepPcAwakeCheckbox) {
            keepPcAwakeCheckbox = document.getElementById('keepPcAwake');
        }
        populateSettingsModal();

        // Final check - if checkbox still not found, log error
        if (!keepPcAwakeCheckbox) {
            console.error('Keep PC awake checkbox could not be found or created!');
            console.log('Available checkboxes:', document.querySelectorAll('input[type="checkbox"]'));
        } else {
            console.log('Keep PC awake checkbox successfully initialized:', keepPcAwakeCheckbox);
        }
    }, 100);

    // Folder picker logic
    if (chooseFolderBtn && downloadFolderInput) {
        chooseFolderBtn.onclick = async () => {
            if (window.electronAPI && window.electronAPI.openFolderDialog) {
                const folderPath = await window.electronAPI.openFolderDialog();
                if (folderPath) {
                    downloadFolderInput.value = folderPath;
                }
            } else {
                console.error('Folder picker not available. window.electronAPI:', window.electronAPI);
                showAlert(t('Folder picker not available. Make sure you are running in Electron.'), t('Not Available'));
            }
        };
    }
    if (defaultFolderBtn && downloadFolderInput) {
        defaultFolderBtn.onclick = async () => {
            if (window.electronAPI && window.electronAPI.getDefaultDownloadFolder) {
                const defaultPath = await window.electronAPI.getDefaultDownloadFolder();
                if (defaultPath) {
                    downloadFolderInput.value = defaultPath;
                }
            } else {
                console.error('Default folder not available. window.electronAPI:', window.electronAPI);
                showAlert(t('Default folder not available. Make sure you are running in Electron.'), t('Not Available'));
            }
        };
    }
    if (openFolderBtn && downloadFolderInput) {
        openFolderBtn.onclick = async () => {
            const folderPath = downloadFolderInput.value;
            if (!folderPath) {
                showAlert(t('No folder selected.'), t('No Selection'));
                return;
            }
            if (window.electronAPI && window.electronAPI.openPathInExplorer) {
                const result = await window.electronAPI.openPathInExplorer(folderPath, folderPath);
                if (!result?.success) {
                    await showAlert(t('Unable to open this folder: {error}', { error: serverError(result, t('Unknown error')) }), t('Open Folder Failed'));
                }
            } else {
                console.error('Open folder not available. window.electronAPI:', window.electronAPI);
                showAlert(t('Open folder not available. Make sure you are running in Electron.'), t('Not Available'));
            }
        };
    }

    // Paste button logic
    if (pasteYoutubeUrlBtn && youtubeUrlInput) {
        pasteYoutubeUrlBtn.onclick = () => navigator.clipboard.readText().then(clipboardText => {
            youtubeUrlInput.value = clipboardText;
            // Dispatch input event to trigger playlist detection
            youtubeUrlInput.dispatchEvent(new Event('input', { bubbles: true }));
            scheduleYoutubePreview({ immediate: true, showErrors: true });
        });
    }
    // Auto-paste URL on window focus
    let lastClipboardUrl = '';

    async function checkClipboardAndPaste() {
        try {
            let clipboardText = '';
            // Use electronAPI if available, otherwise use navigator.clipboard
            if (window.electronAPI && window.electronAPI.readClipboardText) {
                clipboardText = await window.electronAPI.readClipboardText();
            } else if (navigator.clipboard && navigator.clipboard.readText) {
                clipboardText = await navigator.clipboard.readText();
            }

            if (!clipboardText) return;
            clipboardText = clipboardText.trim();

            // Check if it's a URL (any URL as requested)
            const isUrl = /^https?:\/\/.+/i.test(clipboardText);
            if (!isUrl) return;

            // Skip if we already processed this URL
            if (clipboardText === lastClipboardUrl) return;
            lastClipboardUrl = clipboardText;

            // Get the active input field based on current tab
            const activeInput = activeDownloader === 'youtube' ? youtubeUrlInput : null;

            // Only paste if the input field is empty
            if (activeInput && !activeInput.value.trim()) {
                activeInput.value = clipboardText;
                // Dispatch input event to trigger playlist detection
                activeInput.dispatchEvent(new Event('input', { bubbles: true }));
                console.log('[Auto-paste] URL pasted from clipboard:', clipboardText);
            }
        } catch (err) {
            // Silently fail - clipboard access may be denied
            console.warn('Could not read clipboard:', err.message);
        }
    }

    // Check clipboard on window focus
    window.addEventListener('focus', checkClipboardAndPaste);

    // Also check when switching tabs
    if (youtubeTab) youtubeTab.addEventListener('click', () => setTimeout(checkClipboardAndPaste, 100));

    // Delete all buttons with confirmation
    if (clearYoutubeDownloadsBtn && youtubeDownloadLinksArea) {
        clearYoutubeDownloadsBtn.onclick = async () => {
            const confirmed = await confirmDelete(t('Remove all items from the list and stop unfinished downloads? Completed files will be kept.'), t('Clear All Downloads'));
            if (confirmed) {
                clearYoutubeDownloadsBtn.disabled = true;
                try {
                    for (const itemId of [...downloadItemsState.keys()]) {
                        await handleRemoveDownloadItem(itemId, 'youtube');
                    }
                } finally {
                    clearYoutubeDownloadsBtn.disabled = false;
                }
            }
        };
    }

    // Mini-widgets DOM references
    const headerSpeedSlider = document.getElementById('headerSpeedSlider');
    const speedValue = document.getElementById('speedValue');
    const headerThemeSelect = document.getElementById('headerThemeSelect');
    const queuedCount = document.getElementById('queuedCount');
    const downloadingCount = document.getElementById('downloadingCount');
    const downloadedCount = document.getElementById('downloadedCount');

    // Update download stats widget
    function updateDownloadStats() {
        const queuedItems = Array.from(downloadItemsState.values()).filter(item => item.status === 'queued').length;
        const downloadingItems = Array.from(downloadItemsState.values()).filter(item => item.status === 'downloading').length;
        const completedItems = Array.from(downloadItemsState.values()).filter(item => item.status === 'complete').length;
        const pausedItems = Array.from(downloadItemsState.values()).filter(item => item.status === 'paused').length;

        if (queuedCount) queuedCount.textContent = t.formatNumber(queuedItems);
        if (downloadingCount) downloadingCount.textContent = t.formatNumber(downloadingItems);
        if (downloadedCount) downloadedCount.textContent = t.formatNumber(completedItems);
        [[queuedCount, queuedItems], [downloadingCount, downloadingItems], [downloadedCount, completedItems]]
            .forEach(([counter, value]) => counter?.closest('.stat-item')?.classList.toggle('is-active', value > 0));

        const totalCount = downloadItemsState.size;
        if (emptyDownloadState) {
            emptyDownloadState.style.display = totalCount === 0 ? 'flex' : 'none';
        }
        if (clearYoutubeDownloadsBtn) {
            clearYoutubeDownloadsBtn.style.display = totalCount > 0 ? 'block' : 'none';
        }

        // Calculate active downloads (queued + downloading + paused)
        const activeCount = queuedItems + downloadingItems + pausedItems;
        window.__GVL_ACTIVE_DOWNLOAD_COUNT = activeCount;

        // Update the main process for tray icon and close confirmation
        if (window.electronAPI && window.electronAPI.updateDownloadCount) {
            window.electronAPI.updateDownloadCount(activeCount).catch(err => {
                console.warn('Failed to update download count:', err);
            });
        }

        // Manage power save blocker based on active downloads
        managePowerSaveBlocker();
    }

    async function managePowerSaveBlocker() {
        if (!userSettings.keepPcAwake || !window.electronAPI) {
            console.log("Power save blocker disabled or electronAPI missing");
            return;
        }

        const activeDownloads = Array.from(downloadItemsState.values()).filter(
            item => item.status === 'downloading' || item.status === 'queued'
        ).length;

        console.log("Active downloads count:", activeDownloads);
        console.log("Power save blocker currently active:", isPowerSaveBlockerActive);

        if (activeDownloads > 0 && !isPowerSaveBlockerActive) {
            // Start power save blocker
            try {
                console.log("Attempting to start power save blocker...");
                const result = await window.electronAPI.startPowerSaveBlocker();
                console.log("Start power save blocker result:", result);

                if (result.success) {
                    isPowerSaveBlockerActive = true;
                    console.log('✅ Power save blocker activated - keeping PC awake during downloads');
                } else {
                    console.warn('⚠️ Power save blocker start returned success=false:', result.message);
                    // Even if it says "already active", update our state to match
                    isPowerSaveBlockerActive = true;
                }
            } catch (error) {
                console.error('❌ Failed to start power save blocker:', error);
            }
        } else if (activeDownloads === 0 && isPowerSaveBlockerActive) {
            // Stop power save blocker
            try {
                console.log("Attempting to stop power save blocker...");
                const result = await window.electronAPI.stopPowerSaveBlocker();
                console.log("Stop power save blocker result:", result);

                if (result.success) {
                    isPowerSaveBlockerActive = false;
                    console.log('✅ Power save blocker deactivated - PC can sleep normally');
                } else {
                    console.warn('⚠️ Power save blocker stop returned success=false:', result.message);
                    // Even if there was an issue, update our state
                    isPowerSaveBlockerActive = false;
                }
            } catch (error) {
                console.error('❌ Failed to stop power save blocker:', error);
                // Reset state on error
                isPowerSaveBlockerActive = false;
            }
        } else {
            console.log("No state change needed - Downloads:", activeDownloads, "Blocker active:", isPowerSaveBlockerActive);
        }
    }





    // Slider position → Speed mapping (minimum 2 MB/s = 2000 KB/s):
    // 0 → 0 (unlimited)
    // 1-80 → 2000-10000 KB/s (2-10 MB/s, step 100 KB/s)
    // 80-160 → 10000-100000 KB/s (10-100 MB/s, step ~1 MB/s)
    // 160-200 → 100000-500000 KB/s (100-500 MB/s, step 10 MB/s)

    function sliderToSpeed(sliderVal) {
        if (sliderVal === 0) return 0; // Unlimited
        if (sliderVal <= 80) return 2000 + (sliderVal - 1) * 100; // 2-10 MB/s
        if (sliderVal <= 160) return 10000 + (sliderVal - 80) * 1125; // 10-100 MB/s
        return 100000 + (sliderVal - 160) * 10000; // 100-500 MB/s
    }

    function speedToSlider(speed) {
        if (speed === 0) return 0;
        if (speed < 2000) return 1; // Minimum 2 MB/s
        if (speed <= 10000) return 1 + Math.round((speed - 2000) / 100);
        if (speed <= 100000) return 80 + Math.round((speed - 10000) / 1125);
        return 160 + Math.round((speed - 100000) / 10000);
    }

    // Helper to format speed for display
    function formatSpeedDisplay(kbps) {
        if (kbps === 0) return '∞';
        if (kbps >= 1000) {
            return formatFixed(kbps / 1000, 0) + ' MB/s';
        }
        return t.formatNumber(kbps) + ' KB/s';
    }

    if (headerSpeedSlider && speedValue) {
        // Set slider max to accommodate our mapping (200 for 500 MB/s)
        headerSpeedSlider.max = 200;
        headerSpeedSlider.step = 1;
        headerSpeedSlider.value = speedToSlider(userSettings.maxSpeed || 0);
        speedValue.textContent = formatSpeedDisplay(userSettings.maxSpeed || 0);

        headerSpeedSlider.addEventListener('input', (e) => {
            const sliderVal = parseInt(e.target.value, 10);
            const speed = sliderToSpeed(sliderVal);
            speedValue.textContent = formatSpeedDisplay(speed);
        });

        headerSpeedSlider.addEventListener('change', (e) => {
            const sliderVal = parseInt(e.target.value, 10);
            const speed = sliderToSpeed(sliderVal);
            if (maxSpeedInput) maxSpeedInput.value = speed;
            userSettings.maxSpeed = speed;
            saveUserSettingsToStorage();
            // Don't call saveSettings() here - it causes unnecessary logging
            // Settings are already saved to localStorage above
        });
    }

    // Theme Selector Widget
    if (headerThemeSelect) {
        headerThemeSelect.value = userSettings.themePreset || 'light';
        headerThemeSelect.addEventListener('change', (e) => {
            const theme = e.target.value;
            if (themePresetSelect) themePresetSelect.value = theme;
            userSettings.themePreset = theme;
            saveUserSettingsToStorage();
            applyTheme(theme);
            saveSettings();
        });
    }

    // Download Badge Widget
    // function updateDownloadBadge() {
    //     const count = document.querySelectorAll('.download-item').length;
    //     if (downloadCount) downloadCount.textContent = count;
    //     if (downloadBadge) {
    //         if (count > 0) downloadBadge.classList.add('active');
    //         else downloadBadge.classList.remove('active');
    //     }
    // }
    // Call updateDownloadBadge after rendering download items
    // Example: after renderHistoryGroups, updateDownloadBadge();






    // Tool update functions
    window.checkToolsStatus = async function () {
        console.log('=== Checking Tools Status ===');
        try {
            const response = await window.localApiAuth.authorizedFetch('/tools-status');
            const status = await response.json();

            console.log('📋 Tools Status:', status);

            // Display in a nice format
            const ytdlpInfo = status.ytdlp;
            const ffmpegInfo = status.ffmpeg;

            console.log(`🎬 yt-dlp: ${ytdlpInfo.version} (last checked: ${ytdlpInfo.daysSinceLastCheck} days ago)`);
            console.log(`🎥 FFmpeg: ${ffmpegInfo.version} (last checked: ${ffmpegInfo.daysSinceLastCheck} days ago)`);

            return status;
        } catch (error) {
            console.error('❌ Error checking tools status:', error);
            return null;
        }
    };

    window.updateTools = async function () {
        console.log('=== Updating Tools ===');
        try {
            console.log('🔄 Starting tool updates...');

            const response = await window.localApiAuth.authorizedFetch('/update-tools', { method: 'POST' });
            const result = await response.json();

            console.log('📊 Update Results:', result);

            // Display results
            if (result.ytdlp) {
                if (result.ytdlp.updated) {
                    console.log(`✅ yt-dlp updated: ${result.ytdlp.oldVersion} → ${result.ytdlp.newVersion}`);
                } else {
                    console.log(`ℹ️ yt-dlp: ${result.ytdlp.reason || result.ytdlp.error || 'No update needed'}`);
                }
            }

            if (result.ffmpeg) {
                if (result.ffmpeg.hasUpdate) {
                    console.log(`🔄 FFmpeg update available: ${result.ffmpeg.latestVersion}`);
                    console.log(`💡 Note: FFmpeg requires manual download from https://ffmpeg.org/download.html`);
                } else {
                    console.log(`ℹ️ FFmpeg: ${result.ffmpeg.reason || 'No update needed'}`);
                }
            }

            if (result.error) {
                console.error('❌ Update error:', result.error);
            }

            return result;
        } catch (error) {
            console.error('❌ Error updating tools:', error);
            return null;
        }
    };

    window.forceUpdateTools = async function () {
        console.log('=== Force Updating Tools ===');
        try {
            // Clear last update check to force update
            console.log('🔄 Clearing update check timestamps...');

            // Force update by clearing timestamps (this will be handled server-side)
            const response = await window.localApiAuth.authorizedFetch('/force-update-tools', { method: 'POST' });
            const result = await response.json();

            console.log('📊 Force Update Results:', result);
            return result;
        } catch (error) {
            console.error('❌ Error force updating tools:', error);
            return null;
        }
    };









    // Fix playlist detection logic in handleWebSocketMessage and history categorization
    // ... ensure you use:
    // let subtabKey = source;
    // if (source === 'youtube') {
    //     if (currentItemState && currentItemState.isPlaylist) {
    //         subtabKey = 'youtubePlaylists';
    //     } else {
    //         subtabKey = 'youtubeSingles';
    //     }
    // }
    // ... and use the same logic when saving to history

    // After any download list change, call updateDownloadBadge()
    // For example, after adding/removing download items, call updateDownloadBadge();

    const hasRunSetupHealth = Boolean(localStorage.getItem(SETUP_HEALTH_RUN_KEY));
    setSetupHealthSectionVisibility(false);
    if (hasRunSetupHealth && latestSetupHealthResult) {
        renderSetupHealthResult(latestSetupHealthResult);
    } else {
        renderSetupHealthLoading(t('Run the setup health check to verify your local downloader setup.'));
    }

    // ===== HISTORY SUB-TABS =====
    const historyTabs = document.querySelectorAll('.history-tab');
    const historyLists = {
        youtubePlaylists: document.getElementById('historyYoutubePlaylists'),
        youtubeSingles: document.getElementById('historyYoutubeSingles')
    };
    const historyEmptyState = document.getElementById('historyEmptyState');
    const emptyStateDownloadBtn = document.getElementById('emptyStateDownloadBtn');

    if (emptyStateDownloadBtn) {
        emptyStateDownloadBtn.onclick = () => {
            const youtubeTab = document.getElementById('youtubeTab');
            if (youtubeTab) youtubeTab.click();
            const urlInput = document.getElementById('youtubeUrl');
            if (urlInput) urlInput.focus();
        };
    }
    const historySummaryPrimary = document.getElementById('historySummaryPrimary');
    const historySummarySecondary = document.getElementById('historySummarySecondary');
    const historySummaryTertiary = document.getElementById('historySummaryTertiary');

    function getActiveHistoryTabKey() {
        return document.querySelector('.history-tab.active')?.dataset.history || 'youtubeSingles';
    }

    function updateHistorySummary(groupedItems) {
        const singlesCount = groupedItems.youtubeSingles?.length || 0;
        const playlistCount = groupedItems.youtubePlaylists?.length || 0;
        const playlistVideoCount = (groupedItems.youtubePlaylists || []).reduce((total, folder) => {
            return total + (folder.videos?.length || 0);
        }, 0);
        const activeTabKey = getActiveHistoryTabKey();

        if (!historySummaryPrimary || !historySummaryTertiary) return;

        if (activeTabKey === 'youtubePlaylists') {
            historySummaryPrimary.textContent = t.plural(playlistCount, '{count} playlist', '{count} playlists');
            historySummaryTertiary.textContent = t.plural(playlistVideoCount, '{count} video total', '{count} videos total');
            return;
        }

        historySummaryPrimary.textContent = t.plural(singlesCount, '{count} video', '{count} videos');
        historySummaryTertiary.textContent = '';
    }

    function activateHistoryTab(tabKey) {
        Object.values(historyLists).forEach(list => {
            if (list) {
                list.style.display = 'none';
                list.classList.remove('active');
            }
        });
        historyTabs.forEach(btn => btn.classList.remove('active'));
        const list = historyLists[tabKey];
        const btn = document.querySelector(`.history-tab[data-history="${tabKey}"]`);
        if (list) {
            list.style.display = 'grid';
            list.classList.add('active');
        }
        if (btn) btn.classList.add('active');

        const activeItems = lastRenderedHistoryGroups?.[tabKey] || [];
        if (historyEmptyState) {
            historyEmptyState.style.display = activeItems.length === 0 ? 'flex' : 'none';
        }

        // Clear selection when switching tabs and update count
        if (bulkSelectionMode) {
            selectedHistoryItems.clear();
            // Uncheck all checkboxes in the previously visible list
            document.querySelectorAll('.history-item-checkbox:checked, .history-folder-checkbox:checked').forEach(cb => {
                cb.checked = false;
            });
            updateSelectedCount();
        }

        updateHistorySummary(lastRenderedHistoryGroups);
    }

    // History Management Variables
    let historySearchTerm = '';
    let bulkSelectionMode = false;
    let selectedHistoryItems = new Set();
    let currentTimeFilter = 'all';
    let currentSort = 'newest';
    let allHistoryItems = [];
    let lastRenderedHistoryGroups = {
        youtubePlaylists: [],
        youtubeSingles: []
    };
    let backendHistoryItems = null;
    let historyIndexHydrated = false;
    let historyIndexSyncedFromLocal = false;
    let historyIndexLoadPromise = null;
    let historyIndexSyncPromise = null;
    let historyIndexRevision = 0;

    function readStoredHistory() {
        return JSON.parse(localStorage.getItem('ytdHistory') || '[]');
    }

    async function loadHistoryIndexFromBackend(force = false) {
        if (!force && Array.isArray(backendHistoryItems)) {
            return backendHistoryItems;
        }

        if (historyIndexLoadPromise) {
            return historyIndexLoadPromise;
        }

        historyIndexLoadPromise = (async () => {
            const requestRevision = historyIndexRevision;
            try {
                const response = await window.localApiAuth.authorizedFetch(`/history-index?clientId=${encodeURIComponent(clientId)}`);
                if (!response.ok) {
                    throw new Error(`History index request failed with ${response.status}`);
                }

                const data = await response.json();
                const nextBackendItems = Array.isArray(data.items) ? data.items : [];
                if (requestRevision === historyIndexRevision || !Array.isArray(backendHistoryItems)) {
                    backendHistoryItems = nextBackendItems;
                    if (nextBackendItems.length > 0) {
                        localStorage.setItem('ytdHistory', JSON.stringify(nextBackendItems));
                    }
                }
                historyIndexHydrated = true;
                return Array.isArray(backendHistoryItems) ? backendHistoryItems : nextBackendItems;
            } catch (error) {
                console.debug('History index fetch fallback:', error.message);
                return null;
            } finally {
                historyIndexLoadPromise = null;
            }
        })();

        return historyIndexLoadPromise;
    }

    async function syncHistoryIndexToBackend(historyItems = readStoredHistory(), revision = historyIndexRevision) {
        try {
            const response = await window.localApiAuth.authorizedFetch('/history-index/sync', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    clientId,
                    history: historyItems
                })
            });

            if (!response.ok) {
                throw new Error(`History sync failed with ${response.status}`);
            }

            const data = await response.json();
            const nextBackendItems = Array.isArray(data.items) ? data.items : historyItems;
            if (revision === historyIndexRevision) {
                backendHistoryItems = nextBackendItems;
                historyIndexHydrated = true;
            }
            historyIndexHydrated = true;
            historyIndexSyncedFromLocal = true;
            return Array.isArray(backendHistoryItems) ? backendHistoryItems : nextBackendItems;
        } catch (error) {
            console.debug('History index sync fallback:', error.message);
            return historyItems;
        }
    }

    function queueHistoryIndexSync(historyItems = readStoredHistory(), revision = historyIndexRevision) {
        historyIndexSyncPromise = syncHistoryIndexToBackend(historyItems, revision)
            .catch(() => historyItems)
            .finally(() => {
                historyIndexSyncPromise = null;
            });

        return historyIndexSyncPromise;
    }

    function persistStoredHistory(historyItems, { refresh = true } = {}) {
        const nextHistory = Array.isArray(historyItems) ? historyItems.slice(0, 500) : [];
        historyIndexRevision += 1;
        localStorage.setItem('ytdHistory', JSON.stringify(nextHistory));
        backendHistoryItems = nextHistory.slice();
        historyIndexHydrated = true;
        queueHistoryIndexSync(nextHistory, historyIndexRevision);
        if (refresh) {
            filterAndRenderHistory();
        }
        return nextHistory;
    }

    async function getHistorySourceItems() {
        const localHistory = readStoredHistory();
        const backendItems = await loadHistoryIndexFromBackend();

        if ((!Array.isArray(backendItems) || backendItems.length === 0) && localHistory.length > 0 && !historyIndexSyncedFromLocal) {
            await syncHistoryIndexToBackend(localHistory);
        }

        if (Array.isArray(backendHistoryItems) && backendHistoryItems.length > 0) {
            return backendHistoryItems;
        }

        return localHistory;
    }

    // Performance: Debounce function
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // Performance: Throttle function
    function throttle(func, limit) {
        let inThrottle;
        return function (...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }

    // Debounced history filter for better performance
    const debouncedFilterHistory = debounce(() => {
        filterAndRenderHistory();
    }, 300);

    // History Search and Filter Functions
    function setupHistoryManagement() {
        const historySearchInput = document.getElementById('historySearch');
        const clearSearchBtn = document.getElementById('clearSearchBtn');
        const timeFilter = document.getElementById('timeFilter');
        const sortBy = document.getElementById('sortBy');
        const bulkSelectBtn = document.getElementById('bulkSelectBtn');

        if (historySearchInput) {
            historySearchInput.addEventListener('input', (e) => {
                historySearchTerm = e.target.value.toLowerCase().trim();
                debouncedFilterHistory();
            });
            historySearchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    historySearchInput.value = '';
                    historySearchTerm = '';
                    filterAndRenderHistory();
                }
            });
        }
        if (clearSearchBtn) {
            clearSearchBtn.addEventListener('click', () => {
                if (historySearchInput) historySearchInput.value = '';
                historySearchTerm = '';
                filterAndRenderHistory();
            });
        }
        if (timeFilter) {
            timeFilter.addEventListener('change', (e) => {
                currentTimeFilter = e.target.value;
                filterAndRenderHistory();
            });
        }
        if (sortBy) {
            sortBy.addEventListener('change', (e) => {
                currentSort = e.target.value;
                filterAndRenderHistory();
            });
        }
        if (bulkSelectBtn) {
            bulkSelectBtn.addEventListener('click', toggleBulkSelectionMode);
        }
        setupBulkActionButtons();
    }

    function filterHistoryByTime(items) {
        if (currentTimeFilter === 'all') return items;
        const now = new Date();
        const cutoffTime = new Date();
        switch (currentTimeFilter) {
            case 'today':
                cutoffTime.setHours(0, 0, 0, 0);
                break;
            case 'week':
                cutoffTime.setDate(now.getDate() - 7);
                break;
            case 'month':
                cutoffTime.setDate(now.getDate() - 30);
                break;
            default:
                return items;
        }
        return items.filter(item => {
            const itemDate = new Date(item.mtime);
            return itemDate >= cutoffTime;
        });
    }

    function filterHistoryBySearch(items) {
        if (!historySearchTerm) return items;
        return items.filter(item => {
            const title = item.name.toLowerCase();
            const meta = formatHistoryFullTimestamp(item.mtime).toLowerCase();
            return title.includes(historySearchTerm) || meta.includes(historySearchTerm);
        });
    }

    function sortHistoryItems(items) {
        const sorted = [...items];
        switch (currentSort) {
            case 'newest':
                return sorted.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
            case 'oldest':
                return sorted.sort((a, b) => new Date(a.mtime) - new Date(b.mtime));
            case 'name':
                return sorted.sort((a, b) => a.name.localeCompare(b.name));
            case 'size':
                return sorted.sort((a, b) => {
                    const sizeA = parseFloat(a.size) || 0;
                    const sizeB = parseFloat(b.size) || 0;
                    return sizeB - sizeA;
                });
            default:
                return sorted;
        }
    }

    async function filterAndRenderHistory() {
        const allHistory = await getHistorySourceItems();

        let filteredItems = allHistory;

        filteredItems = filterHistoryByTime(filteredItems);
        filteredItems = filterHistoryBySearch(filteredItems);
        filteredItems = sortHistoryItems(filteredItems);

        // Group playlist items by playlistId for folder display
        const playlistGroups = new Map();
        const singleItems = [];

        for (const item of filteredItems) {
            if (item.isPlaylistItem && item.playlistId) {
                // Group playlist items together
                if (!playlistGroups.has(item.playlistId)) {
                    playlistGroups.set(item.playlistId, {
                        isFolder: true,
                        name: item.playlistTitle || t('Playlist'),
                        playlistId: item.playlistId,
                        folder: item.folder,
                        mtime: item.mtime,
                        videos: []
                    });
                }
                playlistGroups.get(item.playlistId).videos.push(item);
            } else if (item.type === 'youtubePlaylists' && !item.isPlaylistItem) {
                // Legacy playlist items without grouping info  
                singleItems.push(item);
            } else {
                singleItems.push(item);
            }
        }

        // Convert playlist groups to array
        const playlistFolders = Array.from(playlistGroups.values());

        const groupedItems = {
            youtubePlaylists: playlistFolders,
            youtubeSingles: singleItems.filter(item => item.type === 'youtubeSingles' || item.type === 'youtube')
        };

        lastRenderedHistoryGroups = groupedItems;
        renderHistoryGroups(groupedItems);
        updateHistorySummary(groupedItems);
        updateItemCount(filteredItems.length);
    }

    async function renderHistoryGroups(groupedItems) {
        const rootFolder = getDownloadFolder();
        Object.values(historyLists).forEach(list => {
            if (list) list.innerHTML = '';
        });

        const totalItems = Object.values(groupedItems).reduce((sum, items) => sum + items.length, 0);
        const activeTabKey = getActiveHistoryTabKey();
        const activeTabItems = groupedItems[activeTabKey]?.length || 0;
        if (historyEmptyState) {
            historyEmptyState.style.display = activeTabItems === 0 ? 'flex' : 'none';
        }

        for (const [type, items] of Object.entries(groupedItems)) {
            const list = historyLists[type];
            if (!list) continue;
            for (const [index, item] of items.entries()) {
                // Check if this is a folder (playlist folder)
                if (item.isFolder && item.videos && item.videos.length > 0) {
                    const folderElement = await createFolderElement(item, index, rootFolder);
                    if (folderElement) {
                        list.appendChild(folderElement);
                    }
                } else {
                    const historyItem = await createHistoryItemElement(item, index, rootFolder);
                    if (historyItem) {
                        list.appendChild(historyItem);
                    }
                }
            }
        }
        if (bulkSelectionMode) {
            applyBulkMode();
        }
        updateDownloadStats(); // Update download badge after rendering history groups
    }

    function formatHistoryTimestamp(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return t.formatDate(date, { dateStyle: 'medium' });
    }

    function formatHistoryFullTimestamp(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return t.formatDate(date, { dateStyle: 'short', timeStyle: 'medium' });
    }

    async function createHistoryItemElement(item, index, rootFolder) {
        try {
            let absPath;

            // Priority: use fullPath if available (most reliable), otherwise resolve from path
            if (item.fullPath) {
                absPath = item.fullPath;
            } else {
                const itemFolder = item.folder || rootFolder;
                if (item.path.startsWith('/downloads/')) {
                    let relativePath = decodeURIComponent(item.path.replace('/downloads/', ''));
                    // If relativePath is already absolute, use it directly
                    const isAbsolute = /^[a-zA-Z]:[\\\/]/.test(relativePath) || relativePath.startsWith('/');
                    if (isAbsolute) {
                        absPath = relativePath;
                    } else if (window.electronAPI?.resolvePath) {
                        absPath = await window.electronAPI.resolvePath(itemFolder, relativePath);
                    } else {
                        absPath = itemFolder + '\\' + relativePath.replace(/\//g, '\\');
                    }
                } else if (item.path.startsWith('http')) {
                    return null;
                } else {
                    absPath = item.path;
                }
            }

            let fileExists = true;
            if (window.electronAPI?.pathExists) {
                fileExists = await window.electronAPI.pathExists(absPath);
            }

            const containingFolder = window.electronAPI?.getDirname && absPath
                ? await window.electronAPI.getDirname(absPath)
                : item.folder || rootFolder;
            const historyItemRoot = containingFolder || item.folder || rootFolder;
            let containingFolderExists = Boolean(containingFolder);
            if (containingFolderExists && window.electronAPI?.pathExists) {
                containingFolderExists = await window.electronAPI.pathExists(containingFolder);
            }

            let thumbnailSrc = item.thumbnail || LOCAL_THUMBNAIL_PLACEHOLDER;
            const escapedThumbnailSrc = escapeHtml(thumbnailSrc);
            const escapedName = escapeHtml(item.name);
            const escapedMissingSuffix = !fileExists ? `<span class="history-missing-badge">${escapeHtml(t('Missing'))}</span>` : '';
            const escapedMtime = escapeHtml(formatHistoryTimestamp(item.mtime));
            const escapedMtimeFull = escapeHtml(formatHistoryFullTimestamp(item.mtime));
            const playTitle = escapeHtml(t('Play Video'));
            const playLabel = escapeHtml(t('Play video'));
            const folderTitle = escapeHtml(t('Open Folder'));
            const folderLabel = escapeHtml(t('Open folder'));
            const deleteTitle = escapeHtml(t('Delete File'));
            const deleteLabel = escapeHtml(t('Delete file'));
            const escapedSize = escapeHtml(item.size);
            const escapedAbsPath = escapeHtml(absPath);
            const escapedHistoryItemRoot = escapeHtml(historyItemRoot);
            const escapedContainingFolder = escapeHtml(containingFolder);

            const div = document.createElement('div');
            div.className = 'history-item';
            div.dataset.index = index;
            div.dataset.originalIndex = findOriginalIndex(item);
            if (!fileExists) {
                div.classList.add('file-missing');
            }
            div.innerHTML = `
                    <div class="history-thumb-wrap">
                        <img class="history-thumb" src="${escapedThumbnailSrc}" alt="" loading="lazy">
                    </div>
                    <div class="history-info">
                        <div class="history-title" title="${escapedName}">${escapedName}</div>
                        <div class="history-meta-row">
                            <div class="history-meta">${escapedMissingSuffix}<span title="${escapedMtimeFull}">${escapedMtime}</span><span class="history-meta-dot" aria-hidden="true">·</span><span>${escapedSize}</span></div>
                            <div class="history-actions">
                                <button class="history-action-btn play" title="${playTitle}" aria-label="${playLabel}" data-action="play" data-root="${escapedHistoryItemRoot}" data-path="${escapedAbsPath}" data-index="${index}" ${!fileExists ? 'disabled' : ''}>
                                    <i class="fas fa-play"></i>
                                </button>
                                <button class="history-action-btn folder" title="${folderTitle}" aria-label="${folderLabel}" data-action="folder" data-root="${escapedHistoryItemRoot}" data-path="${escapedContainingFolder}" data-index="${index}" ${!containingFolderExists ? 'disabled' : ''}>
                                    <i class="fas fa-folder-open"></i>
                                </button>
                                <button class="history-action-btn delete" title="${deleteTitle}" aria-label="${deleteLabel}" data-action="delete" data-root="${escapedHistoryItemRoot}" data-path="${escapedAbsPath}" data-index="${index}">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </div>
                        </div>
                    </div>`;
            const historyThumb = div.querySelector('.history-thumb');
            if (historyThumb) {
                historyThumb.addEventListener('error', () => {
                    historyThumb.src = LOCAL_THUMBNAIL_PLACEHOLDER;
                }, { once: true });
            }
            return div;
        } catch (error) {
            console.error(`Error creating history item element:`, error);
            return null;
        }
    }

    async function createFolderElement(folderItem, index, rootFolder) {
        try {
            const folderPath = folderItem.path || folderItem.folder;
            let absPath = folderPath;

            // Resolve absolute path if needed
            if (folderPath && window.electronAPI?.resolvePath) {
                // Check if path is relative (doesn't start with drive letter or /)
                const isRelative = !/^[a-zA-Z]:[\\/]/.test(folderPath) && !folderPath.startsWith('/');
                if (isRelative) {
                    absPath = await window.electronAPI.resolvePath(rootFolder, folderPath);
                } else {
                    absPath = folderPath;
                }
            }

            let folderExists = true;
            if (window.electronAPI?.pathExists) {
                folderExists = await window.electronAPI.pathExists(absPath);
            }

            const folderDiv = document.createElement('div');
            folderDiv.className = 'history-folder';
            folderDiv.dataset.index = index;
            folderDiv.dataset.folderPath = absPath;
            folderDiv.dataset.expanded = 'false';
            folderDiv.dataset.originalIndex = findOriginalIndex(folderItem);
            folderDiv.dataset.playlistId = folderItem.playlistId; // Store playlistId for folder deletion

            const videoCount = folderItem.videoCount || (folderItem.videos ? folderItem.videos.length : 0);
            const folderName = folderItem.name || t('Playlist Folder');
            const escapedFolderName = escapeHtml(folderName);
            const escapedFolderMtime = escapeHtml(formatHistoryTimestamp(folderItem.mtime));
            const escapedFolderMtimeFull = escapeHtml(formatHistoryFullTimestamp(folderItem.mtime));
            const escapedFolderSize = escapeHtml(folderItem.size);

            folderDiv.innerHTML = `
                <div class="history-folder-header">
                    <button class="history-folder-toggle" type="button">
                        <i class="fas fa-chevron-right" aria-hidden="true"></i>
                    </button>
                    <span class="history-folder-icon" aria-hidden="true"><i class="fas fa-folder"></i></span>
                    <div class="history-folder-info">
                        <div class="history-title">${escapedFolderName}</div>
                        <div class="history-meta"><span title="${escapedFolderMtimeFull}">${escapedFolderMtime}</span>${escapedFolderSize ? `<span class="history-meta-dot" aria-hidden="true">·</span><span>${escapedFolderSize}</span>` : ''}</div>
                    </div>
                    <span class="history-folder-count">${escapeHtml(t.plural(videoCount, '{count} video', '{count} videos'))}</span>
                </div>
                <div class="history-folder-content"></div>
            `;

            const header = folderDiv.querySelector('.history-folder-header');
            header.setAttribute('aria-expanded', 'false');
            const contentDiv = folderDiv.querySelector('.history-folder-content');

            const toggleExpansion = async (e) => {
                // Don't toggle expansion if in bulk mode or if clicking checkbox
                if (bulkSelectionMode || e.target.type === 'checkbox') {
                    return;
                }
                e.stopPropagation(); // Prevent bubbling if needed

                const isExpanded = folderDiv.dataset.expanded === 'true';

                if (!isExpanded && contentDiv.children.length === 0) {
                    // Load videos when first expanded
                    if (folderItem.videos && folderItem.videos.length > 0) {
                        for (let i = 0; i < folderItem.videos.length; i++) {
                            const video = folderItem.videos[i];
                            // Pass rootFolder to correctly resolve paths if needed
                            const videoElement = await createHistoryItemElement(video, `${index}_${i}`, rootFolder);
                            if (videoElement) {
                                contentDiv.appendChild(videoElement);
                            }
                        }
                    }
                }

                folderDiv.dataset.expanded = isExpanded ? 'false' : 'true';
                header.setAttribute('aria-expanded', String(!isExpanded));
            };

            // Toggle on click of the toggle button OR the header
            const toggleBtn = folderDiv.querySelector('.history-folder-toggle');
            if (toggleBtn) {
                toggleBtn.setAttribute('aria-label', t('Toggle {name}', { name: folderName }));
                toggleBtn.addEventListener('click', toggleExpansion);
            }
            header.addEventListener('click', toggleExpansion);
            makeElementKeyboardClickable(header, () => toggleExpansion({
                target: header,
                stopPropagation() { }
            }), t('Toggle {name}', { name: folderName }));


            if (!folderExists) {
                folderDiv.classList.add('file-missing');
            }

            return folderDiv;
        } catch (error) {
            console.error(`Error creating folder element:`, error);
            return null;
        }
    }

    function findOriginalIndex(targetItem) {
        const allHistory = readStoredHistory();
        if (targetItem.isFolder) {
            // For folders, find the first playlist item that belongs to this folder
            // Folders don't exist in history, but their playlist items do
            return allHistory.findIndex(item =>
                item.isPlaylistItem &&
                item.playlistId === targetItem.playlistId &&
                item.folder === targetItem.folder
            );
        } else {
            // Match regular items by name, mtime, and path
            return allHistory.findIndex(item =>
                item.name === targetItem.name &&
                item.mtime === targetItem.mtime &&
                item.path === targetItem.path
            );
        }
    }

    function updateItemCount(count) {
        const itemCountEl = document.getElementById('itemCount');
        if (itemCountEl) {
            itemCountEl.textContent = t.plural(count, '{count} item', '{count} items');
        }
    }

    // Bulk Selection Functions
    function toggleBulkSelectionMode() {
        bulkSelectionMode = !bulkSelectionMode;
        const bulkActionsDiv = document.getElementById('historyBulkActions');
        const bulkSelectBtn = document.getElementById('bulkSelectBtn');
        const clearHistoryBtn = document.getElementById('clearHistoryBtn');
        if (bulkSelectionMode) {
            if (bulkActionsDiv) bulkActionsDiv.style.display = 'flex';
            if (bulkSelectBtn) {
                bulkSelectBtn.innerHTML = `<i class="fas fa-times"></i> ${escapeHtml(t('Exit Bulk'))}`;
                bulkSelectBtn.classList.add('danger-btn');
            }
            if (clearHistoryBtn) clearHistoryBtn.style.display = 'none';
            applyBulkMode();
        } else {
            if (bulkActionsDiv) bulkActionsDiv.style.display = 'none';
            if (bulkSelectBtn) {
                bulkSelectBtn.innerHTML = `<i class="fas fa-check-square"></i> ${escapeHtml(t('Bulk Select'))}`;
                bulkSelectBtn.classList.remove('danger-btn');
            }
            if (clearHistoryBtn) clearHistoryBtn.style.display = '';
            removeBulkMode();
        }
    }

    function applyBulkMode() {
        selectedHistoryItems.clear();
        document.querySelectorAll('.history-item').forEach((item) => {
            item.classList.add('bulk-mode');
            const existingCheckbox = item.querySelector('.history-item-checkbox');
            if (existingCheckbox) existingCheckbox.remove();

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'history-item-checkbox';
            checkbox.dataset.originalIndex = item.dataset.originalIndex;
            checkbox.addEventListener('change', handleHistoryItemSelection);

            // Prevent checkbox click from triggering item click twice if bubbling issues arise, 
            // but relying on the item click handler is cleaner for the user experience.
            checkbox.addEventListener('click', (e) => e.stopPropagation());

            item.appendChild(checkbox);

            // Add click listener to the container for selection
            item.addEventListener('click', handleItemContainerClick);

            // Disable all action buttons in the item
            const itemButtons = item.querySelectorAll('button');
            itemButtons.forEach(btn => {
                btn.disabled = true;
                btn.style.opacity = '0.5';
                btn.style.pointerEvents = 'none';
            });
        });
        // Apply bulk mode to folder elements
        document.querySelectorAll('.history-folder').forEach((folder) => {
            folder.classList.add('bulk-mode');
            const existingCheckbox = folder.querySelector('.history-folder-checkbox');
            if (existingCheckbox) existingCheckbox.remove();

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'history-folder-checkbox';
            checkbox.dataset.originalIndex = folder.dataset.originalIndex;
            checkbox.addEventListener('change', handleFolderSelection);

            checkbox.addEventListener('click', (e) => e.stopPropagation());

            // Insert checkbox at the beginning of the folder header
            const header = folder.querySelector('.history-folder-header');
            if (header) {
                header.insertBefore(checkbox, header.firstChild);

                // Add click handler to folder header for selection in bulk mode
                const folderHeaderClickHandler = (e) => {
                    // Only handle selection if bulk mode is active
                    if (!bulkSelectionMode) {
                        return; // Don't interfere if bulk mode is off
                    }
                    // Don't trigger selection if clicking the checkbox, toggle button, or action buttons
                    if (e.target === checkbox || e.target.type === 'checkbox' || e.target.closest('.history-folder-toggle') || e.target.closest('.history-action-btn')) {
                        return;
                    }
                    // Toggle checkbox state
                    e.stopPropagation(); // Prevent toggleExpansion from firing
                    checkbox.checked = !checkbox.checked;
                    checkbox.dispatchEvent(new Event('change'));
                };
                // Use capture phase to fire before toggleExpansion
                header.addEventListener('click', folderHeaderClickHandler, true);
                // Store handler reference on the header for potential cleanup
                header._bulkModeClickHandler = folderHeaderClickHandler;
            }

            // Disable all action buttons in the folder (especially the folder open button)
            const folderButtons = folder.querySelectorAll('.history-action-btn');
            folderButtons.forEach(btn => {
                btn.disabled = true;
                btn.style.opacity = '0.5';
                btn.style.pointerEvents = 'none';
            });

            // Disable folder toggle during bulk mode
            const toggleBtn = folder.querySelector('.history-folder-toggle');
            if (toggleBtn) {
                toggleBtn.disabled = true;
                toggleBtn.style.opacity = '0.5';
                toggleBtn.style.pointerEvents = 'none';
            }
        });
        updateSelectedCount();
        updateSelectAllButtonState(false);
    }

    function removeBulkMode() {
        document.querySelectorAll('.history-item').forEach((item) => {
            item.classList.remove('bulk-mode');
            item.classList.remove('selected'); // Remove selected state
            const checkbox = item.querySelector('.history-item-checkbox');
            if (checkbox) checkbox.remove();

            // Remove click listener
            item.removeEventListener('click', handleItemContainerClick);

            // Re-enable action buttons
            const itemButtons = item.querySelectorAll('button');
            itemButtons.forEach(btn => {
                btn.disabled = false;
                btn.style.opacity = '1';
                btn.style.pointerEvents = 'auto';
            });
        });
        // Remove bulk mode from folder elements
        document.querySelectorAll('.history-folder').forEach((folder) => {
            folder.classList.remove('bulk-mode');
            folder.classList.remove('selected'); // Remove selected state
            const checkbox = folder.querySelector('.history-folder-checkbox');
            if (checkbox) checkbox.remove();

            // Remove the bulk mode click handler if it exists
            const header = folder.querySelector('.history-folder-header');
            if (header && header._bulkModeClickHandler) {
                header.removeEventListener('click', header._bulkModeClickHandler, true);
                delete header._bulkModeClickHandler;
            }

            // Re-enable action buttons
            const folderButtons = folder.querySelectorAll('.history-action-btn');
            folderButtons.forEach(btn => {
                btn.disabled = false;
                btn.style.opacity = '1';
                btn.style.pointerEvents = 'auto';
            });

            // Re-enable folder toggle
            const toggleBtn = folder.querySelector('.history-folder-toggle');
            if (toggleBtn) {
                toggleBtn.disabled = false;
                toggleBtn.style.opacity = '1';
                toggleBtn.style.pointerEvents = 'auto';
            }
        });
        selectedHistoryItems.clear();
        updateSelectedCount();
    }

    // Handler for clicking the history item container in bulk mode
    function handleItemContainerClick(e) {
        // Find the checkbox within this item
        const checkbox = this.querySelector('.history-item-checkbox');
        if (checkbox) {
            checkbox.checked = !checkbox.checked;
            checkbox.dispatchEvent(new Event('change'));
        }
    }

    // Duplicate removeBulkMode removed

    function handleHistoryItemSelection(e) {
        const item = e.target.closest('.history-item');
        const originalIndex = parseInt(e.target.dataset.originalIndex);
        if (e.target.checked) {
            selectedHistoryItems.add(originalIndex);
            item.classList.add('selected');
        } else {
            selectedHistoryItems.delete(originalIndex);
            item.classList.remove('selected');
        }
        updateSelectedCount();
    }

    function handleFolderSelection(e) {
        const folder = e.target.closest('.history-folder');
        const originalIndex = parseInt(e.target.dataset.originalIndex);
        if (originalIndex >= 0) { // Only proceed if we found a valid index
            if (e.target.checked) {
                selectedHistoryItems.add(originalIndex);
                folder.classList.add('selected');
            } else {
                selectedHistoryItems.delete(originalIndex);
                folder.classList.remove('selected');
            }
            updateSelectedCount();
        }
    }

    function updateSelectedCount() {
        const countSpan = document.getElementById('selectedCount');
        if (countSpan) {
            // Only count checkboxes that are in the currently active/visible history list
            const activeList = document.querySelector('.history-list.active, .history-list[style*="grid"]');
            let visibleCheckboxes = [];
            if (activeList) {
                visibleCheckboxes = activeList.querySelectorAll('.history-item-checkbox:checked, .history-folder-checkbox:checked');
            } else {
                // Fallback: find the visible list
                const visibleList = Array.from(document.querySelectorAll('.history-list')).find(list =>
                    list.style.display !== 'none' && list.style.display !== ''
                );
                if (visibleList) {
                    visibleCheckboxes = visibleList.querySelectorAll('.history-item-checkbox:checked, .history-folder-checkbox:checked');
                }
            }
            const count = visibleCheckboxes.length;
            countSpan.textContent = t('{count} selected', { count: t.formatNumber(count) });
        }
        // Update Select All button state - only checkboxes in the active tab
        const activeList = document.querySelector('.history-list.active, .history-list[style*="grid"]');
        let checkboxes = [];
        if (activeList) {
            checkboxes = Array.from(activeList.querySelectorAll('.history-item-checkbox, .history-folder-checkbox'));
        } else {
            const visibleList = Array.from(document.querySelectorAll('.history-list')).find(list =>
                list.style.display !== 'none' && list.style.display !== ''
            );
            if (visibleList) {
                checkboxes = Array.from(visibleList.querySelectorAll('.history-item-checkbox, .history-folder-checkbox'));
            }
        }
        if (checkboxes.length > 0) {
            const allChecked = checkboxes.every(cb => cb.checked);
            updateSelectAllButtonState(allChecked);
        }
    }

    function setupBulkActionButtons() {
        document.addEventListener('click', (e) => {
            if (e.target.closest('#selectAllHistoryBtn')) {
                toggleSelectAll();
            } else if (e.target.closest('#deleteSelectedBtn')) {
                deleteSelectedItems();
            } else if (e.target.closest('#cancelSelectionBtn')) {
                toggleBulkSelectionMode();
            }
        });
    }

    function toggleSelectAll() {
        // Only work with checkboxes in the currently active/visible history list
        const activeList = document.querySelector('.history-list.active, .history-list[style*="grid"]');
        let checkboxes = [];
        if (activeList) {
            checkboxes = Array.from(activeList.querySelectorAll('.history-item-checkbox, .history-folder-checkbox'));
        } else {
            const visibleList = Array.from(document.querySelectorAll('.history-list')).find(list =>
                list.style.display !== 'none' && list.style.display !== ''
            );
            if (visibleList) {
                checkboxes = Array.from(visibleList.querySelectorAll('.history-item-checkbox, .history-folder-checkbox'));
            }
        }
        const allChecked = checkboxes.length > 0 && checkboxes.every(cb => cb.checked);

        if (allChecked) {
            // Deselect all
            deselectAllItems();
        } else {
            // Select all
            selectAllItems();
        }
    }

    function updateSelectAllButtonState(allSelected) {
        const selectAllBtn = document.getElementById('selectAllHistoryBtn');
        if (!selectAllBtn) return;

        const icon = selectAllBtn.querySelector('i');
        if (allSelected) {
            selectAllBtn.innerHTML = `<i class="fas fa-square"></i> ${escapeHtml(t('Deselect All'))}`;
        } else {
            selectAllBtn.innerHTML = `<i class="fas fa-check-square"></i> ${escapeHtml(t('Select All'))}`;
        }
    }

    function selectAllItems() {
        // Only select checkboxes in the currently active/visible history list
        const activeList = document.querySelector('.history-list.active, .history-list[style*="grid"]');
        let checkboxes = [];
        if (activeList) {
            checkboxes = Array.from(activeList.querySelectorAll('.history-item-checkbox, .history-folder-checkbox'));
        } else {
            const visibleList = Array.from(document.querySelectorAll('.history-list')).find(list =>
                list.style.display !== 'none' && list.style.display !== ''
            );
            if (visibleList) {
                checkboxes = Array.from(visibleList.querySelectorAll('.history-item-checkbox, .history-folder-checkbox'));
            }
        }
        checkboxes.forEach(cb => {
            if (!cb.checked) {
                cb.checked = true;
                cb.dispatchEvent(new Event('change'));
            }
        });
        updateSelectAllButtonState(true);
    }

    // Clear History Logic with 3-button modal
    function setupClearHistoryButton() {
        const clearBtn = document.getElementById('clearHistoryBtn');
        if (clearBtn) {
            clearBtn.addEventListener('click', async () => {
                const activeTabBtn = document.querySelector('.history-tab.active');
                if (!activeTabBtn) return;

                const type = activeTabBtn.dataset.history;
                const isPlaylistTab = type === 'youtubePlaylists';

                // Show custom 3-button modal
                const result = await showClearHistoryModal(isPlaylistTab);

                if (result === 'cancel') return;

                let history = readStoredHistory();

                if (result === 'clearAll') {
                    // Clear all history
                    persistStoredHistory([]);
                    showNotification(t('All history cleared.'), 'success');
                } else if (result === 'clearTab') {
                    // Clear only current tab - filter out items that belong to current tab
                    history = history.filter(item => {
                        if (type === 'youtubePlaylists') {
                            // Keep everything that's NOT a playlist item or folder
                            return !(item.isPlaylistItem && item.playlistId) && !item.isFolder;
                        } else {
                            // youtubeSingles - keep if it's a playlist item or folder
                            const isPlaylist = (item.isPlaylistItem && item.playlistId) || item.isFolder;
                            return isPlaylist;
                        }
                    });
                    persistStoredHistory(history);
                    showNotification(isPlaylistTab ? t('Video Playlists history cleared.') : t('Video Singles history cleared.'), 'success');
                }
            });
        }
    }

    // Custom 3-button clear history modal
    function showClearHistoryModal(isPlaylistTab) {
        return new Promise((resolve) => {
            // Remove existing modal if any
            const existing = document.getElementById('clearHistoryModal');
            if (existing) existing.remove();
            const clearTabTitle = escapeHtml(isPlaylistTab ? t('Clear Video Playlists') : t('Clear Video Singles'));
            const clearTabDesc = escapeHtml(isPlaylistTab ? t('Remove video playlists only') : t('Remove video singles only'));

            const modal = document.createElement('div');
            modal.id = 'clearHistoryModal';
            modal.className = 'modal';
            modal.style.cssText = `
                display: flex;
                position: fixed;
                inset: 0;
                background: rgba(0, 0, 0, 0.6);
                backdrop-filter: blur(4px);
                z-index: 9999;
                align-items: center;
                justify-content: center;
                animation: fadeIn 0.2s ease;
            `;

            modal.innerHTML = `
                <div class="modal-content close-confirmation-modal clear-history-modal">
                    <div class="confirmation-icon">
                        <i class="fas fa-trash-alt"></i>
                    </div>
                    <h2 class="clear-history-title">${escapeHtml(t('Clear History'))}</h2>
                    <p class="clear-history-text">
                        ${escapeHtml(t('What would you like to clear?'))}<br>
                        <small>${escapeHtml(t('This action cannot be undone.'))}</small>
                    </p>
                    <div class="close-actions-grid">
                        <button id="clearTabBtn" class="action-btn primary-btn-glow">
                            <i class="fas fa-folder-minus"></i>
                            <div>
                                <span class="btn-title">${clearTabTitle}</span>
                                <span class="btn-desc">${clearTabDesc}</span>
                            </div>
                        </button>
                        <button id="clearAllBtn" class="action-btn danger-btn-outline">
                            <i class="fas fa-trash"></i>
                            <div>
                                <span class="btn-title">${escapeHtml(t('Clear All'))}</span>
                                <span class="btn-desc">${escapeHtml(t('Remove entire history'))}</span>
                            </div>
                        </button>
                    </div>
                    <div class="close-cancel-row">
                        <button id="cancelClearBtn" class="text-btn">${escapeHtml(t('Cancel'))}</button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            // Button handlers
            modal.querySelector('#clearTabBtn').onclick = () => {
                modal.remove();
                resolve('clearTab');
            };
            modal.querySelector('#clearAllBtn').onclick = () => {
                modal.remove();
                resolve('clearAll');
            };
            modal.querySelector('#cancelClearBtn').onclick = () => {
                modal.remove();
                resolve('cancel');
            };

            // Close on backdrop click
            modal.onclick = (e) => {
                if (e.target === modal) {
                    modal.remove();
                    resolve('cancel');
                }
            };

            // Close on Escape
            const escHandler = (e) => {
                if (e.key === 'Escape') {
                    modal.remove();
                    document.removeEventListener('keydown', escHandler);
                    resolve('cancel');
                }
            };
            document.addEventListener('keydown', escHandler);
        });
    }

    /**
     * Shows a premium-grade toast notification.
     * @param {string} message - The message to display.
     * @param {'info' | 'success' | 'error' | 'warning'} type - The type of notification.
     */
    function showNotification(message, type = 'info') {
        const existing = document.querySelector('.notification-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = `notification-toast toast-${type}`;

        let icon = 'info-circle';
        if (type === 'success') icon = 'check-circle';
        if (type === 'error') icon = 'exclamation-circle';
        if (type === 'warning') icon = 'exclamation-triangle';
        const escapedMessage = escapeHtml(message);

        toast.innerHTML = `
            <div class="toast-content">
                <i class="fas fa-${icon} toast-icon"></i>
                <div class="toast-message">${escapedMessage}</div>
            </div>
            <div class="toast-progress"></div>
        `;
        document.body.appendChild(toast);

        // Auto-remove after 4 seconds
        setTimeout(() => {
            toast.classList.add('toast-exit');
            setTimeout(() => toast.remove(), 400);
        }, 4000);
    }



    // Call setup
    setupClearHistoryButton();

    function deselectAllItems() {
        // Only deselect checkboxes in the currently active/visible history list
        const activeList = document.querySelector('.history-list.active, .history-list[style*="grid"]');
        let checkboxes = [];
        if (activeList) {
            checkboxes = Array.from(activeList.querySelectorAll('.history-item-checkbox, .history-folder-checkbox'));
        } else {
            const visibleList = Array.from(document.querySelectorAll('.history-list')).find(list =>
                list.style.display !== 'none' && list.style.display !== ''
            );
            if (visibleList) {
                checkboxes = Array.from(visibleList.querySelectorAll('.history-item-checkbox, .history-folder-checkbox'));
            }
        }
        checkboxes.forEach(cb => {
            if (cb.checked) {
                cb.checked = false;
                cb.dispatchEvent(new Event('change'));
            }
        });
        updateSelectAllButtonState(false);
    }

    async function deleteSelectedItems() {
        // Get selected items from the currently active/visible history list
        const activeList = document.querySelector('.history-list.active, .history-list[style*="grid"]');
        let visibleCheckedItems = [];
        if (activeList) {
            visibleCheckedItems = Array.from(activeList.querySelectorAll('.history-item-checkbox:checked, .history-folder-checkbox:checked'));
        } else {
            const visibleList = Array.from(document.querySelectorAll('.history-list')).find(list =>
                list.style.display !== 'none' && list.style.display !== ''
            );
            if (visibleList) {
                visibleCheckedItems = Array.from(visibleList.querySelectorAll('.history-item-checkbox:checked, .history-folder-checkbox:checked'));
            }
        }

        if (visibleCheckedItems.length === 0) {
            await showAlert(t('No items selected for deletion.'), t('No Selection'));
            return;
        }

        // Get the original indices from the checked items
        const indicesToDelete = visibleCheckedItems.map(cb => parseInt(cb.dataset.originalIndex)).filter(idx => idx >= 0);

        const confirmMessage = t.plural(indicesToDelete.length, 'Delete {count} selected item permanently?', 'Delete {count} selected items permanently?');
        const confirmed = await confirmDelete(confirmMessage, t('Delete Selected Items'));
        if (!confirmed) return;

        const history = readStoredHistory();
        const sortedIndicesToDelete = indicesToDelete.sort((a, b) => b - a);
        let deletedCount = 0;
        let removedCount = 0;

        // First, collect all items to delete
        // Distinguish between folder selections (delete entire folder) and individual item selections (delete only selected items)
        const itemsToDelete = new Map(); // Map<index, item>
        const folderPlaylistIds = new Set(); // Track playlist IDs for folders that were explicitly selected via folder checkbox

        // Check which checkboxes were selected - folder checkboxes vs individual item checkboxes
        const selectedFolderCheckboxes = visibleCheckedItems.filter(cb => cb.classList.contains('history-folder-checkbox'));
        const selectedItemCheckboxes = visibleCheckedItems.filter(cb => cb.classList.contains('history-item-checkbox'));

        // If folder checkboxes are selected, mark those playlist IDs for full folder deletion
        for (const folderCb of selectedFolderCheckboxes) {
            const index = parseInt(folderCb.dataset.originalIndex);
            if (index >= 0 && index < history.length) {
                const item = history[index];
                if (item && item.playlistId) {
                    folderPlaylistIds.add(item.playlistId);
                }
            }
        }

        // Add all selected items to deletion map
        for (const index of sortedIndicesToDelete) {
            if (index >= 0 && index < history.length) {
                const item = history[index];
                if (item) {
                    itemsToDelete.set(index, item);
                }
            }
        }

        // For folders that were explicitly selected (via folder checkbox), find all playlist items with the same playlistId
        // Only do this for folders that were selected via folder checkbox, not for individual items
        if (folderPlaylistIds.size > 0) {
            for (let i = 0; i < history.length; i++) {
                const item = history[i];
                if (item && item.isPlaylistItem && item.playlistId && folderPlaylistIds.has(item.playlistId)) {
                    // Add all items from this folder to deletion
                    if (!itemsToDelete.has(i)) {
                        itemsToDelete.set(i, item);
                    }
                }
            }
        }

        // Sort indices in descending order for safe deletion
        const sortedIndices = Array.from(itemsToDelete.keys()).sort((a, b) => b - a);

        // Get folder paths to delete (only delete folders if the entire folder was selected)
        // Only delete folders if they were selected via folder checkbox, not if only individual items were selected
        const foldersToDelete = new Set();
        for (const index of sortedIndices) {
            const item = itemsToDelete.get(index);
            // Only delete the folder if this playlistId was in folderPlaylistIds (meaning folder checkbox was selected)
            if (item && item.isPlaylistItem && item.playlistId && item.folder && folderPlaylistIds.has(item.playlistId)) {
                // Store the folder path for deletion (we'll resolve it properly)
                foldersToDelete.add(item.folder);
            }
        }

        // Delete folders first
        for (const folderPath of foldersToDelete) {
            try {
                let absPath = folderPath;
                if (folderPath && window.electronAPI?.resolvePath) {
                    // Check if path is relative
                    const isRelative = !/^[a-zA-Z]:[\\/]/.test(folderPath) && !folderPath.startsWith('/');
                    if (isRelative) {
                        absPath = await window.electronAPI.resolvePath(getDownloadFolder(), folderPath);
                    }
                }
                if (absPath && window.electronAPI?.deleteFolder) {
                    const containingFolder = window.electronAPI?.getDirname
                        ? await window.electronAPI.getDirname(absPath)
                        : getDownloadFolder();
                    const result = await window.electronAPI.deleteFolder(containingFolder, absPath);
                    if (result.success) deletedCount++;
                }
            } catch (error) {
                console.error(`Failed to delete folder ${folderPath}:`, error);
            }
        }

        // Delete individual files and remove from history
        for (const index of sortedIndices) {
            const item = itemsToDelete.get(index);
            if (item) {
                try {
                    // If this item is part of a folder that was fully deleted (folder checkbox selected),
                    // skip individual file deletion as the folder was already deleted
                    // Otherwise, delete the individual file
                    const isPartOfDeletedFolder = item.isPlaylistItem && item.playlistId && folderPlaylistIds.has(item.playlistId);
                    if (!isPartOfDeletedFolder) {
                        // Delete individual file
                        if (window.electronAPI?.deleteFile) {
                            let absPath;
                            if (item.fullPath) {
                                absPath = item.fullPath;
                            } else if (item.path && item.path.startsWith('/downloads/')) {
                                const relativePath = decodeURIComponent(item.path.replace('/downloads/', ''));
                                absPath = await window.electronAPI.resolvePath(item.folder || getDownloadFolder(), relativePath);
                            } else if (item.path) {
                                absPath = item.path;
                            }
                            if (absPath) {
                                const containingFolder = window.electronAPI?.getDirname
                                    ? await window.electronAPI.getDirname(absPath)
                                    : item.folder || getDownloadFolder();
                                const result = await window.electronAPI.deleteFile(containingFolder, absPath);
                                if (result.success) deletedCount++;
                            }
                        }
                    }
                } catch (error) {
                    console.error(`Failed to delete file for item ${index}:`, error);
                }
            }
            // Remove from history
            history.splice(index, 1);
            removedCount++;
        }
        persistStoredHistory(history, { refresh: false });
        selectedHistoryItems.clear();
        toggleBulkSelectionMode();
        filterAndRenderHistory();
        let message;
        if (deletedCount === 1) {
            message = t.plural(removedCount, 'Successfully deleted {deleted} item and removed {count} item from history.', 'Successfully deleted {deleted} item and removed {count} items from history.', { deleted: deletedCount });
        } else if (deletedCount > 1) {
            message = t.plural(removedCount, 'Successfully deleted {deleted} items and removed {count} item from history.', 'Successfully deleted {deleted} items and removed {count} items from history.', { deleted: deletedCount });
        } else {
            message = t.plural(removedCount, 'Removed {count} item from history.', 'Removed {count} items from history.');
        }
        await showAlert(message, t('Deletion Complete'));
    }

    // clearHistoryBtn is now handled by setupClearHistoryButton() with 3-button modal

    // History action buttons event listener
    document.addEventListener('click', async (e) => {
        const actionBtn = e.target.closest('.history-action-btn');
        if (!actionBtn) return;

        const action = actionBtn.dataset.action;
        const rootPath = actionBtn.dataset.root;
        const filePath = actionBtn.dataset.path;
        const index = parseInt(actionBtn.dataset.index);

        if (action === 'play') {
            if (window.electronAPI?.openMediaFile) {
                const result = await window.electronAPI.openMediaFile(rootPath, filePath);
                if (!result?.success) {
                    await showAlert(t('Unable to play this video: {error}', { error: serverError(result, t('Unknown error')) }), t('Playback Failed'));
                }
            } else {
                await showAlert(t('Video playback is only available in the desktop app.'), t('Not Available'));
            }
        } else if (action === 'folder') {
            if (window.electronAPI?.openPathInExplorer) {
                const result = await window.electronAPI.openPathInExplorer(rootPath, filePath);
                if (!result?.success) {
                    await showAlert(t('Unable to open this folder: {error}', { error: serverError(result, t('Unknown error')) }), t('Open Folder Failed'));
                }
            } else {
                await showAlert(t('Opening folders is only available in the desktop app.'), t('Not Available'));
            }
        } else if (action === 'delete') {
            const confirmed = await confirmDelete(t('Are you sure you want to delete this file?'), t('Delete File'));
            if (confirmed) {
                try {
                    if (window.electronAPI?.deleteFile) {
                        const result = await window.electronAPI.deleteFile(rootPath, filePath);
                        if (result.success) {
                            // Remove from history
                            const history = readStoredHistory();
                            const historyItem = actionBtn.closest('.history-item');
                            const originalIndex = parseInt(historyItem.dataset.originalIndex);
                            if (originalIndex >= 0 && originalIndex < history.length) {
                                history.splice(originalIndex, 1);
                                persistStoredHistory(history);
                            }
                        } else {
                            await showAlert(t('Failed to delete file: {error}', { error: serverError(result, t('Unknown error')) }), t('Deletion Failed'));
                        }
                    }
                } catch (error) {
                    console.error('Error deleting file:', error);
                    await showAlert(t('Error deleting file: {error}', { error: error.message }), t('Error'));
                }
            }
        }
    });

    // Wire the history tabs
    historyTabs.forEach(btn =>
        btn.addEventListener('click', () => {
            activateHistoryTab(btn.dataset.history);
            filterAndRenderHistory();
        })
    );

    // Initial history setup
    activateHistoryTab('youtubeSingles');
    setupHistoryManagement();
    filterAndRenderHistory();

    async function scanDownloadFolderAndUpdateHistory() {
        if (!window.electronAPI || !window.electronAPI.listDownloadFolder) return;
        const folder = getDownloadFolder();
        const files = await window.electronAPI.listDownloadFolder(folder);
    }

    function renderFromLocalStorage() {
        filterAndRenderHistory();
    }

    if (downloadFolderInput) {
        downloadFolderInput.addEventListener('change', scanDownloadFolderAndUpdateHistory);
    }

    scanDownloadFolderAndUpdateHistory();

    // UI Scale slider event listener
    const uiScaleInput = document.getElementById('uiScale');
    const uiScaleValue = document.getElementById('uiScaleValue');

    if (uiScaleInput && uiScaleValue) {
        uiScaleInput.addEventListener('input', (e) => {
            const scaleValue = parseFloat(e.target.value);
            uiScaleValue.textContent = formatUIScaleLabel(scaleValue);
            applyUIScale(scaleValue);
        });

        uiScaleInput.addEventListener('change', (e) => {
            const scaleValue = clampNumber(parseFloat(e.target.value), UI_SCALE_MIN, UI_SCALE_MAX);
            e.target.value = scaleValue;
            userSettings.uiScale = scaleValue;
            saveUserSettingsToStorage();
            uiScaleValue.textContent = formatUIScaleLabel(scaleValue);
        });
    }

    // ===== ONBOARDING WIZARD SYSTEM =====
    initOnboarding();

    // ===== SCROLL TO TOP BUTTON =====

    // ===== UPDATE CHECK & CHANGELOG SYSTEM =====
const UPDATE_LAST_SEEN_KEY = 'gvl_lastSeenVersion';
const UPDATE_POPUP_DELAY_MS = 2500;
// The server stamps the running version into <html data-app-version>; this is
// only a fallback. Keep the changelog below in step with each release.
const DEFAULT_APP_VERSION = '3.2.13';
const FALLBACK_APP_CHANGELOG = {
    version: '3.2.13',
    title: t("What's new in {version}", { version: '3.2.13' }),
    date: 'November 2026',
    required: false,
    badge: '',
    summary: '',
    items: [
        { icon: 'fa-language', title: t('Now in 41 languages'), desc: t('Pick your language in Settings → General → Appearance.') },
        { icon: 'fa-font', title: t('Made for every script'), desc: t('Arabic, Hebrew, Persian and Urdu read right to left, and every language gets a clear font made for its script.') }
    ]
};
let updatePopupTimer = null;

function getCurrentAppVersion() {
    const rawVersion = document.documentElement.dataset.appVersion?.trim() || '';
    return rawVersion || DEFAULT_APP_VERSION;
}

function getValidAppChangelog() {
    const changelog = window.APP_CHANGELOG || FALLBACK_APP_CHANGELOG;
    if (!changelog || !Array.isArray(changelog.items) || changelog.items.length === 0) {
        return FALLBACK_APP_CHANGELOG;
    }

    const normalizedItems = changelog.items
        .filter(item => item && typeof item === 'object')
        .map((item) => ({
            icon: String(item.icon || 'fa-circle-info'),
            title: String(item.title || t('Update')),
            desc: String(item.desc || t('Latest improvements are now available.'))
        }));

    return {
        version: String(changelog.version || getCurrentAppVersion()),
        title: String(changelog.title || t("What's New in v{version}", { version: getCurrentAppVersion() })),
        date: String(changelog.date || ''),
        required: changelog.required === true,
        badge: String(changelog.badge || ''),
        summary: String(changelog.summary || ''),
        items: normalizedItems.length > 0 ? normalizedItems : FALLBACK_APP_CHANGELOG.items
    };
}

function showLatestChangesPopup(options = {}) {
    const immediate = options.immediate === true;
    const force = options.force === true;
    const version = getCurrentAppVersion();
    const lastSeen = localStorage.getItem(UPDATE_LAST_SEEN_KEY);

    if (!force && lastSeen === version) {
        return false;
    }

    const changelog = getValidAppChangelog();
    // Only announce notes written for this version; a patch without its own
    // notes should not re-show the previous release's list.
    if (!force && changelog.version !== version) {
        return false;
    }
    window.clearTimeout(updatePopupTimer);

    const openPopup = () => showUpdatePopup(changelog, version, UPDATE_LAST_SEEN_KEY);
    if (immediate) {
        openPopup();
    } else {
        updatePopupTimer = window.setTimeout(openPopup, UPDATE_POPUP_DELAY_MS);
    }

    return true;
}

function initUpdateCheck() {
    if (!localStorage.getItem('ytdTutorialCompleted')) {
        return;
    }

    showLatestChangesPopup();
}

window.resetLastSeenVersion = function resetLastSeenVersion() {
    localStorage.removeItem(UPDATE_LAST_SEEN_KEY);
    const currentValue = localStorage.getItem(UPDATE_LAST_SEEN_KEY);
    console.log(`[UpdateCheck] ${UPDATE_LAST_SEEN_KEY} reset. Current value:`, currentValue);
    return currentValue;
};

window.showLatestChangesPopup = function showLatestChangesPopupFromConsole() {
    const shown = showLatestChangesPopup({ immediate: true, force: true });
    console.log(`[UpdateCheck] Forced popup trigger result: ${shown ? 'shown' : 'skipped'}`);
    return shown;
};

function showUpdatePopup(changelog, version, storageKey) {
    const modal = document.getElementById('updateModal');
    const content = document.getElementById('updateContent');
    if (!modal || !content) return;

    const itemsHtml = changelog.items.map(item => `
        <div class="update-item">
            <div class="update-item-icon">
                <i class="fas ${item.icon}"></i>
            </div>
            <div class="update-item-text">
                <div class="update-item-title">${item.title}</div>
                <div class="update-item-desc">${item.desc}</div>
            </div>
        </div>
    `).join('');
    const requiredBadgeHtml = changelog.required
        ? `<span class="update-required-badge">${changelog.badge || escapeHtml(t('Required'))}</span>`
        : '';
    const summaryHtml = changelog.summary
        ? `<p class="onboarding-step-subtitle update-summary">${changelog.summary}</p>`
        : `<p class="onboarding-step-subtitle">${escapeHtml(t("You've been updated to version {version}. Here's what's new.", { version }))}</p>`;

    content.innerHTML = `
        <div class="onboarding-progress-bar">
            <div class="onboarding-progress-fill update-progress-fill"></div>
        </div>
        <button class="onboarding-close-btn update-close-btn" id="updateCloseBtn" type="button" aria-label="${escapeHtml(t("Close what's new"))}">
            <i class="fas fa-times" aria-hidden="true"></i>
        </button>
        <div class="onboarding-scroll-area">
            <div class="onboarding-step-view">
                <div class="onboarding-success-icon update-success-icon">
                    <i class="fas fa-arrow-up-from-bracket"></i>
                </div>
                <div class="update-title-row">
                    <h2 class="onboarding-step-title">${changelog.title}</h2>
                    ${requiredBadgeHtml}
                </div>
                ${summaryHtml}
                <div class="update-items-list">
                    ${itemsHtml}
                </div>
            </div>
        </div>
        <div class="onboarding-nav-bar">
            <div class="onboarding-nav-info">v${version}</div>
            <div class="onboarding-nav-actions">
                <button class="onboarding-btn primary" id="updateDismissBtn" type="button">Got it</button>
            </div>
        </div>
    `;

    // The template keeps the English label; swap in the translation here.
    const dismissButton = document.getElementById('updateDismissBtn');
    if (dismissButton) dismissButton.textContent = t('Got it');

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    modal.onclick = (e) => {
        if (e.target === modal) dismissUpdate(modal, storageKey, version);
    };

    const dismiss = () => dismissUpdate(modal, storageKey, version);
    document.getElementById('updateDismissBtn')?.addEventListener('click', dismiss);
    document.getElementById('updateCloseBtn')?.addEventListener('click', dismiss);

    document.addEventListener('keydown', function handler(e) {
        if (e.key === 'Escape' && modal.style.display === 'flex') {
            dismissUpdate(modal, storageKey, version);
            document.removeEventListener('keydown', handler);
        }
    });
}

function dismissUpdate(modal, storageKey, version) {
    modal.style.display = 'none';
    document.body.style.overflow = '';
    localStorage.setItem(storageKey, version);
    flushSettingsToDisk();
}

// ===== SCROLL TO TOP BUTTON =====
    initScrollToTop();
    // Initialize only after the update constants and onboarding state exist.
    initUpdateCheck();
});

function initScrollToTop() {
    const scrollToTopBtn = document.getElementById('scrollToTopBtn');
    if (!scrollToTopBtn) return;

    // Show/hide button based on scroll position
    function toggleScrollButton() {
        if (window.pageYOffset > 300) {
            scrollToTopBtn.classList.add('show');
        } else {
            scrollToTopBtn.classList.remove('show');
        }
    }

    // Scroll to top when button is clicked
    scrollToTopBtn.addEventListener('click', () => {
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    });

    // Listen for scroll events
    window.addEventListener('scroll', toggleScrollButton);

    // Initial check
    toggleScrollButton();
}

// Onboarding Wizard System
function initOnboarding() {
    const modal = document.getElementById('onboardingModal');
    const content = document.getElementById('onboardingContent');

    if (!modal || !content) return;

    let currentStep = 0;

    const onboardingState = {
        downloadFolder: getPersistedDownloadFolder(),
        format: userSettings?.defaultFormat || 'mp4',
        quality: userSettings?.defaultQuality || 'highest',
        rememberChoices: userSettings?.rememberDownloadChoices !== false,
        notifications: {
            sound: userSettings?.notificationSound ?? true,
            desktop: userSettings?.notificationPopup ?? false
        }
    };

    const TOTAL_STEPS = 5;

    const steps = [
        { id: 'welcome', label: t('Go to welcome step') },
        { id: 'location', label: t('Go to location step') },
        { id: 'format', label: t('Go to format step') },
        { id: 'notifications', label: t('Go to notifications step') },
        { id: 'complete', label: t('Go to complete step') }
    ];

    function flashHighlight(element, duration = 1500) {
        if (!element) return;
        element.classList.add('onboarding-flash-highlight');
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => {
            element.classList.remove('onboarding-flash-highlight');
        }, duration);
    }

    function getFolderDisplay() {
        const saved = getPersistedDownloadFolder();
        if (saved) {
            onboardingState.downloadFolder = saved;
            return saved;
        }
        return t('Downloads folder');
    }

    function persistOnboardingSettings(settingsPatch) {
        userSettings = {
            ...(userSettings || loadSettings()),
            ...settingsPatch
        };
        saveUserSettingsToStorage();
        window.userSettings = userSettings;
    }

    function persistDownloadFolder(folderPath) {
        const persistedFolderPath = persistDownloadFolderPath(folderPath);
        onboardingState.downloadFolder = persistedFolderPath;
    }

    function getQualityOptions(format) {
        return ['mp4', 'mkv'].includes(format)
            ? [
                ['highest', t('Best available (up to 8K)')],
                ['2160', '4K (2160p)'],
                ['1440', '2K (1440p)'],
                ['1080', 'Full HD (1080p)'],
                ['720', 'HD (720p)']
            ]
            : [
                ['highest', t('Highest quality')],
                ['320', '320 kbps'],
                ['256', '256 kbps'],
                ['192', '192 kbps']
            ];
    }

    function populateOnboardingQuality(format, preferredQuality) {
        const qualityInput = document.getElementById('onboardingQuality');
        if (!qualityInput) return;

        const qualityOptions = getQualityOptions(format);
        qualityInput.replaceChildren(...qualityOptions.map(([quality, label]) => {
            const option = document.createElement('option');
            option.value = quality;
            option.textContent = label;
            return option;
        }));
        qualityInput.value = qualityOptions.some(([quality]) => quality === preferredQuality)
            ? preferredQuality
            : qualityOptions[0][0];
        onboardingState.quality = qualityInput.value;
    }

    function shortenPath(path, maxLen = 45) {
        if (!path || path.length <= maxLen) return path;
        return '...' + path.slice(-(maxLen - 3));
    }

    function escapeOnboardingText(rawText) {
        return String(rawText ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function renderSetupProgress(activeIndex) {
        return steps.map((step, index) => {
            const stateClass = index < activeIndex
                ? 'is-complete'
                : index === activeIndex
                    ? 'is-active'
                    : '';
            const label = index < activeIndex
                ? '<i class="fas fa-check" aria-hidden="true"></i>'
                : String(index + 1);
            return `<button class="setup-step-pill onboarding-step-dot ${stateClass}" type="button" data-step="${index}" aria-label="${escapeOnboardingText(step.label)}" ${index > activeIndex ? 'disabled' : ''}>${label}</button>`;
        }).join('');
    }

    function renderSetupShell({ index, title, subtitle, visualIcon, body, actions }) {
        return `
            <div class="setup-shell">
                <header class="setup-header">
                    <img class="setup-brand-logo" src="/public/Logo1.ico" alt="GetVideosLocally" />
                    <div class="setup-progress" aria-label="${escapeOnboardingText(t('Setup progress'))}">
                        ${renderSetupProgress(index)}
                    </div>
                    <button class="setup-close onboarding-close-btn" type="button" aria-label="${escapeOnboardingText(t('Close setup'))}">
                        <i class="fas fa-xmark" aria-hidden="true"></i>
                    </button>
                </header>
                <main class="setup-main">
                    <section class="setup-copy">
                        <p class="setup-kicker">${escapeOnboardingText(t('Step {step} of {total}', { step: t.formatNumber(index + 1), total: t.formatNumber(TOTAL_STEPS) }))}</p>
                        <h2 class="setup-title">${title}</h2>
                        <p class="setup-subtitle">${subtitle}</p>
                        <div class="setup-body">${body}</div>
                    </section>
                    <div class="setup-visual" aria-hidden="true">
                        <div class="setup-visual-orbit"></div>
                        <div class="setup-visual-core"><i class="fas ${visualIcon}"></i></div>
                    </div>
                </main>
                <footer class="setup-footer">
                    <span class="setup-footer-note">${escapeOnboardingText(t('You can change these options later in Settings.'))}</span>
                    <div class="setup-actions">${actions}</div>
                </footer>
            </div>
        `;
    }

    function renderWelcome() {
        const body = `
            <div class="setup-feature-list">
                <span><i class="fas fa-bolt"></i> ${escapeOnboardingText(t('Fast downloads with yt-dlp and FFmpeg'))}</span>
                <span><i class="fas fa-shield-halved"></i> ${escapeOnboardingText(t('Private processing on your computer'))}</span>
                <span><i class="fas fa-film"></i> ${escapeOnboardingText(t('Video, audio, playlists, and batch downloads'))}</span>
            </div>`;
        const actions = `
            <button class="setup-btn setup-btn-ghost" data-action="skip">${escapeOnboardingText(t('Skip setup'))}</button>
            <button class="setup-btn setup-btn-primary" data-action="next">${escapeOnboardingText(t('Get started'))} <i class="fas fa-arrow-right"></i></button>`;
        return renderSetupShell({
            index: 0,
            title: escapeOnboardingText(t('Welcome to GetVideosLocally')),
            subtitle: escapeOnboardingText(t('Download videos and audio from more than {count} supported sites—fast, private, and entirely on your computer.', { count: t.formatNumber(1000) })),
            visualIcon: 'fa-play',
            body,
            actions
        });
    }

    function renderLocation() {
        const currentFolder = getFolderDisplay();
        const shortFolder = shortenPath(currentFolder);
        const body = `
            <div class="setup-form-group">
                <label for="onboardingFolder">${escapeOnboardingText(t('Download location'))}</label>
                <div class="setup-folder-row">
                    <div class="setup-path-field"><i class="far fa-folder"></i><input type="text" id="onboardingFolder" readonly value="${escapeOnboardingText(shortFolder)}" /></div>
                    <button class="setup-btn setup-btn-outline" id="onboardingChooseFolder" type="button"><i class="far fa-folder-open"></i> ${escapeOnboardingText(t('Choose'))}</button>
                </div>
            </div>
            <div class="setup-tip"><i class="fas fa-circle-info"></i><span>${escapeOnboardingText(t("We'll create the folder for you if it doesn't exist yet."))}</span></div>
            <p class="setup-location-status" id="onboardingFolderStatus" aria-live="polite"></p>`;
        const actions = `
            <button class="setup-btn setup-btn-outline" data-action="prev"><i class="fas fa-arrow-left"></i> Back</button>
            <button class="setup-btn setup-btn-primary" data-action="next">Continue <i class="fas fa-arrow-right"></i></button>`;
        return renderSetupShell({
            index: 1,
            title: escapeOnboardingText(t('Where should we save your downloads?')),
            subtitle: escapeOnboardingText(t('Choose a folder on your computer. You can always change this later in Settings.')),
            visualIcon: 'fa-folder-open',
            body,
            actions
        });
    }

    function renderFormat() {
        const currentFormat = document.getElementById('format')?.value || onboardingState.format;
        const qualityOptions = getQualityOptions(currentFormat);
        const selectedQuality = qualityOptions.some(([quality]) => quality === onboardingState.quality)
            ? onboardingState.quality
            : qualityOptions[0][0];
        const formats = [
            ['mp4', 'fa-film', t('MP4 Video'), t('Best compatibility')],
            ['mp3', 'fa-music', t('MP3 Audio'), t('Music and podcasts')],
            ['mkv', 'fa-file-video', t('MKV Video'), t('Multi-track video')],
            ['flac', 'fa-headphones', t('FLAC Audio'), t('Lossless audio')]
        ];
        const body = `
            <div class="setup-format-grid" id="onboardingFormatChoices">
                ${formats.map(([format, icon, label, description]) => `
                    <button class="setup-format-option onboarding-choice-card ${currentFormat === format ? 'selected' : ''}" type="button" data-format="${format}">
                        <i class="fas ${icon}"></i>
                        <span><strong>${escapeOnboardingText(label)}</strong><small>${escapeOnboardingText(description)}</small></span>
                        <i class="fas fa-circle-check setup-option-check"></i>
                    </button>`).join('')}
            </div>
            <div class="setup-quality-row">
                <label for="onboardingQuality">${escapeOnboardingText(t('Preferred quality'))}</label>
                <select id="onboardingQuality">
                    ${qualityOptions.map(([quality, label]) => `<option value="${quality}" ${selectedQuality === quality ? 'selected' : ''}>${escapeOnboardingText(label)}</option>`).join('')}
                </select>
            </div>
            <div class="setup-toggle-list setup-remember-choices">
                <label class="setup-toggle-row">
                    <span class="setup-toggle-copy"><i class="fas fa-clock-rotate-left"></i><span><strong>${escapeOnboardingText(t('Remember my last choices'))}</strong><small>${escapeOnboardingText(t('Keep the format, quality and concurrent downloads you last used. When off, every launch starts with the choices above.'))}</small></span></span>
                    <span class="setup-switch"><input type="checkbox" id="onboardingRememberChoices" ${onboardingState.rememberChoices ? 'checked' : ''}><span></span></span>
                </label>
            </div>`;
        const actions = `
            <button class="setup-btn setup-btn-outline" data-action="prev"><i class="fas fa-arrow-left"></i> Back</button>
            <button class="setup-btn setup-btn-primary" data-action="next">Continue <i class="fas fa-arrow-right"></i></button>`;
        return renderSetupShell({
            index: 2,
            title: escapeOnboardingText(t('What do you download most?')),
            subtitle: escapeOnboardingText(t('Choose your default format. You can switch formats for any download later.')),
            visualIcon: 'fa-sliders',
            body,
            actions
        });
    }

    function renderNotifications() {
        const soundEnabled = document.getElementById('notificationSound')?.checked ?? onboardingState.notifications.sound;
        const desktopEnabled = document.getElementById('notificationPopup')?.checked ?? onboardingState.notifications.desktop;
        const body = `
            <div class="setup-toggle-list">
                <label class="setup-toggle-row">
                    <span class="setup-toggle-copy"><i class="fas fa-volume-high"></i><span><strong>${escapeOnboardingText(t('Sound alerts'))}</strong><small>${escapeOnboardingText(t('Play a sound when downloads complete'))}</small></span></span>
                    <span class="setup-switch"><input type="checkbox" id="onboardingSoundToggle" ${soundEnabled ? 'checked' : ''}><span></span></span>
                </label>
                <label class="setup-toggle-row">
                    <span class="setup-toggle-copy"><i class="fas fa-desktop"></i><span><strong>${escapeOnboardingText(t('Desktop notifications'))}</strong><small>${escapeOnboardingText(t('Show a system notification when done'))}</small></span></span>
                    <span class="setup-switch"><input type="checkbox" id="onboardingDesktopToggle" ${desktopEnabled ? 'checked' : ''}><span></span></span>
                </label>
            </div>`;
        const actions = `
            <button class="setup-btn setup-btn-outline" data-action="prev"><i class="fas fa-arrow-left"></i> Back</button>
            <button class="setup-btn setup-btn-primary" data-action="next">Continue <i class="fas fa-arrow-right"></i></button>`;
        return renderSetupShell({
            index: 3,
            title: escapeOnboardingText(t('Stay in the loop')),
            subtitle: escapeOnboardingText(t('Choose how GetVideosLocally should let you know when a download finishes.')),
            visualIcon: 'fa-bell',
            body,
            actions
        });
    }

    function renderComplete() {
        const formatLabels = { mp4: t('MP4 Video'), mp3: t('MP3 Audio'), mkv: t('MKV Video'), flac: t('FLAC Audio'), wav: t('WAV Audio'), m4a: t('M4A Audio'), opus: t('Opus Audio'), webm: t('WEBM Video'), mov: t('MOV Video') };
        const formatLabel = escapeOnboardingText(formatLabels[onboardingState.format] || onboardingState.format.toUpperCase());
        const qualityLabel = escapeOnboardingText(getQualityOptions(onboardingState.format)
            .find(([quality]) => quality === onboardingState.quality)?.[1] || t('Highest quality'));
        const onLabel = escapeOnboardingText(t('On'));
        const offLabel = escapeOnboardingText(t('Off'));
        const folder = escapeOnboardingText(shortenPath(onboardingState.downloadFolder || getFolderDisplay(), 35));
        const soundOn = document.getElementById('onboardingSoundToggle')?.checked ?? onboardingState.notifications.sound;
        const desktopOn = document.getElementById('onboardingDesktopToggle')?.checked ?? onboardingState.notifications.desktop;
        const body = `
            <dl class="setup-summary">
                <div><dt>${escapeOnboardingText(t('Download folder'))}</dt><dd>${folder}</dd></div>
                <div><dt>${escapeOnboardingText(t('Default format'))}</dt><dd>${formatLabel}</dd></div>
                <div><dt>${escapeOnboardingText(t('Preferred quality'))}</dt><dd>${qualityLabel}</dd></div>
                <div><dt>${escapeOnboardingText(t('Sound alerts'))}</dt><dd>${soundOn ? onLabel : offLabel}</dd></div>
                <div><dt>${escapeOnboardingText(t('Desktop notifications'))}</dt><dd>${desktopOn ? onLabel : offLabel}</dd></div>
            </dl>`;
        const actions = `
            <button class="setup-btn setup-btn-outline" data-action="prev"><i class="fas fa-arrow-left"></i> Back</button>
            <button class="setup-btn setup-btn-primary" data-action="finish">${escapeOnboardingText(t('Start downloading'))} <i class="fas fa-arrow-right"></i></button>`;
        return renderSetupShell({
            index: 4,
            title: escapeOnboardingText(t("You're all set!")),
            subtitle: escapeOnboardingText(t('Your preferences are saved. Paste a video URL to start your first download.')),
            visualIcon: 'fa-check',
            body,
            actions
        });
    }

    function renderStep(index) {
        const renderers = [renderWelcome, renderLocation, renderFormat, renderNotifications, renderComplete];
        content.innerHTML = renderers[index]();
        content.scrollTop = 0;
        content.querySelector('.setup-main')?.scrollTo({ top: 0, left: 0 });
        attachStepListeners(index);
    }

    function applyLocationChoice() {
        const folderInput = document.getElementById('onboardingFolder');
        if (folderInput && folderInput.value && !folderInput.value.includes('...')) {
            onboardingState.downloadFolder = folderInput.value;
        } else {
            onboardingState.downloadFolder = getFolderDisplay();
        }
    }

    function applyFormatChoice() {
        const rememberToggle = document.getElementById('onboardingRememberChoices');
        if (rememberToggle) {
            onboardingState.rememberChoices = rememberToggle.checked;
            const el = document.getElementById('rememberDownloadChoices');
            if (el) el.checked = rememberToggle.checked;
        }
        persistOnboardingSettings({ rememberDownloadChoices: onboardingState.rememberChoices });
        const selected = document.querySelector('.onboarding-choice-card.selected');
        if (selected) {
            const format = selected.dataset.format;
            onboardingState.format = format;
            const onboardingQuality = document.getElementById('onboardingQuality');
            onboardingState.quality = onboardingQuality?.value || 'highest';
            const formatSelect = document.getElementById('format');
            if (formatSelect) {
                formatSelect.value = format;
                formatSelect.dispatchEvent(new Event('change'));
            }
            const qualitySelect = document.getElementById('quality');
            if (qualitySelect && Array.from(qualitySelect.options).some(option => option.value === onboardingState.quality)) {
                qualitySelect.value = onboardingState.quality;
            }
            persistOnboardingSettings({
                defaultFormat: onboardingState.format,
                defaultQuality: onboardingState.quality
            });
        }
    }

    function applyNotificationChoices() {
        const soundToggle = document.getElementById('onboardingSoundToggle');
        const desktopToggle = document.getElementById('onboardingDesktopToggle');

        if (soundToggle) {
            onboardingState.notifications.sound = soundToggle.checked;
            const el = document.getElementById('notificationSound');
            if (el) el.checked = soundToggle.checked;
        }
        if (desktopToggle) {
            onboardingState.notifications.desktop = desktopToggle.checked;
            const el = document.getElementById('notificationPopup');
            if (el) el.checked = desktopToggle.checked;
        }
        persistOnboardingSettings({
            notificationSound: onboardingState.notifications.sound,
            notificationPopup: onboardingState.notifications.desktop
        });
    }

    function attachStepListeners(index) {
        content.querySelector('[data-action="next"]')?.addEventListener('click', () => {
            if (index === 1) applyLocationChoice();
            if (index === 2) applyFormatChoice();
            if (index === 3) applyNotificationChoices();
            if (index < TOTAL_STEPS - 1) {
                currentStep++;
                renderStep(currentStep);
            }
        });

        content.querySelector('[data-action="prev"]')?.addEventListener('click', () => {
            if (index > 0) {
                currentStep--;
                renderStep(currentStep);
            }
        });

        content.querySelector('[data-action="skip"]')?.addEventListener('click', closeModal);

        content.querySelector('[data-action="finish"]')?.addEventListener('click', () => {
            closeModal();
            setTimeout(() => {
                const urlInput = document.getElementById('youtubeUrl');
                if (urlInput) {
                    flashHighlight(urlInput);
                    urlInput.focus();
                }
            }, 300);
        });

        content.querySelector('.onboarding-close-btn')?.addEventListener('click', closeModal);

        if (index === 1) {
            document.getElementById('onboardingChooseFolder')?.addEventListener('click', async () => {
                const chooseButton = document.getElementById('onboardingChooseFolder');
                const status = document.getElementById('onboardingFolderStatus');
                const setStatus = (message, state = '') => {
                    if (!status) return;
                    status.textContent = message;
                    status.dataset.state = state;
                };

                if (!window.electronAPI?.openFolderDialog) {
                    setStatus(t('The folder picker is unavailable. Restart the desktop app and try again.'), 'error');
                    return;
                }

                if (chooseButton) {
                    chooseButton.disabled = true;
                    chooseButton.setAttribute('aria-busy', 'true');
                    chooseButton.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${escapeOnboardingText(t('Choosing'))}`;
                }
                setStatus(t('Waiting for a folder selection…'));

                try {
                    const selectedFolderPath = await window.electronAPI.openFolderDialog();
                    if (!selectedFolderPath) {
                        setStatus(t('No folder selected. Your current location is unchanged.'));
                        return;
                    }

                    const normalizedFolderPath = normalizeDownloadFolderPath(selectedFolderPath);
                    persistDownloadFolder(normalizedFolderPath);
                    const folderInput = document.getElementById('onboardingFolder');
                    if (folderInput) {
                        folderInput.value = shortenPath(normalizedFolderPath);
                        folderInput.title = normalizedFolderPath;
                    }
                    setStatus(t('Saved to Settings.'), 'success');
                } catch (folderPickerError) {
                    console.error('Folder selection failed:', folderPickerError);
                    setStatus(t('We could not open the folder picker. Please try again.'), 'error');
                } finally {
                    if (chooseButton) {
                        chooseButton.disabled = false;
                        chooseButton.removeAttribute('aria-busy');
                        chooseButton.innerHTML = `<i class="far fa-folder-open"></i> ${escapeOnboardingText(t('Choose'))}`;
                    }
                }
            });
        }

        if (index === 2) {
            content.querySelectorAll('.onboarding-choice-card').forEach(card => {
                card.addEventListener('click', () => {
                    content.querySelectorAll('.onboarding-choice-card').forEach(c => c.classList.remove('selected'));
                    card.classList.add('selected');
                    onboardingState.format = card.dataset.format;
                    populateOnboardingQuality(onboardingState.format, onboardingState.quality);
                });
            });
            document.getElementById('onboardingQuality')?.addEventListener('change', event => {
                onboardingState.quality = event.target.value;
            });
        }

        if (index === 3) {
            const soundToggle = document.getElementById('onboardingSoundToggle');
            const desktopToggle = document.getElementById('onboardingDesktopToggle');
            if (soundToggle) soundToggle.addEventListener('change', () => {
                onboardingState.notifications.sound = soundToggle.checked;
            });
            if (desktopToggle) desktopToggle.addEventListener('change', () => {
                onboardingState.notifications.desktop = desktopToggle.checked;
            });
        }

        content.querySelectorAll('.onboarding-step-dot').forEach(dot => {
            dot.addEventListener('click', () => {
                const targetStep = parseInt(dot.dataset.step);
                if (!isNaN(targetStep) && targetStep < currentStep) {
                    currentStep = targetStep;
                    renderStep(currentStep);
                }
            });
        });

        modal.onclick = (e) => {
            if (e.target === modal) closeModal();
        };
    }

    function openModal() {
        currentStep = 0;
        renderStep(currentStep);
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        const settingsModal = document.getElementById('settingsModal');
        if (settingsModal) settingsModal.style.display = 'none';
    }

    function closeModal() {
        modal.style.display = 'none';
        document.body.style.overflow = '';
        localStorage.setItem('ytdTutorialCompleted', 'true');
        flushSettingsToDisk();
        applyNotificationChoices();
    }

    window.openOnboarding = openModal;

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.style.display === 'flex') {
            closeModal();
        }
    });

    const onboardingCompleted = localStorage.getItem('ytdTutorialCompleted');
    if (!onboardingCompleted) {
        setTimeout(() => openModal(), 1000);
    }
}

// Ensure default download folder is set correctly on first launch
window.addEventListener('DOMContentLoaded', async () => {
    const downloadFolderInput = document.getElementById('downloadFolder');

    // Get the app's downloads folder (for first startup) and user's Downloads folder (for default button)
    let appDownloadsPath = '';
    let userDownloadsPath = '';

    // Try to get paths from Electron API
    if (window.electronAPI && window.electronAPI.getDefaultDownloadFolder) {
        try {
            userDownloadsPath = await window.electronAPI.getDefaultDownloadFolder();
        } catch (e) {
            console.error('Failed to get default download folder:', e);
        }
    }

    // Get app directory path for first startup
    if (window.electronAPI && window.electronAPI.getUserDataPath) {
        try {
            const userDataPath = await window.electronAPI.getUserDataPath();
            // Use a 'downloads' folder inside the app's userData directory
            appDownloadsPath = userDataPath.replace(/\\/g, '/') + '/downloads';
        } catch (e) {
            console.error('Failed to get userData path:', e);
            // Fallback: use userDownloadsPath if available
            appDownloadsPath = userDownloadsPath || '';
        }
    } else {
        // Fallback if no Electron API - will be set by userDownloadsPath if available
        appDownloadsPath = userDownloadsPath || '';
    }

    if (downloadFolderInput) {
        const savedFolder = getPersistedDownloadFolder();
        const isFirstLaunch = !localStorage.getItem('hasLaunchedBefore');
        const initialFolder = savedFolder || (isFirstLaunch
            ? appDownloadsPath || userDownloadsPath
            : userDownloadsPath || appDownloadsPath);

        persistDownloadFolderPath(initialFolder);
        localStorage.setItem('hasLaunchedBefore', 'true');
    }
    // ==================== CLOSE CONFIRMATION MODAL LOGIC ====================
    if (window.electronAPI && window.electronAPI.onShowCloseConfirmation) {
        const closeConfirmationModal = document.getElementById('closeConfirmationModal');
        const closeConfirmExitBtn = document.getElementById('closeConfirmExitBtn');
        const closeConfirmTrayBtn = document.getElementById('closeConfirmTrayBtn');
        const closeConfirmCancelBtn = document.getElementById('closeConfirmCancelBtn');
        const closeConfirmationMessage = document.getElementById('closeConfirmationMessage');

        // Listen for close confirmation request from Main Process
        window.electronAPI.onShowCloseConfirmation((activeCount) => {
            if (closeConfirmationModal && closeConfirmationMessage) {
                // Update message with count
                closeConfirmationMessage.textContent = t.plural(activeCount, '{count} download is currently in progress. What would you like to do?', '{count} downloads are currently in progress. What would you like to do?');

                // Show modal
                openModalWithFocus(closeConfirmationModal, closeConfirmTrayBtn || closeConfirmCancelBtn);

                // Animate entry
                const modalContent = closeConfirmationModal.querySelector('.modal-content');
                if (modalContent) {
                    modalContent.style.animation = 'none';
                    modalContent.offsetHeight; /* trigger reflow */
                    modalContent.style.animation = 'scaleIn 0.3s ease-out forwards';
                }
            }
        });

        // ACTION: Cancel & Exit
        if (closeConfirmExitBtn) {
            closeConfirmExitBtn.onclick = () => {
                if (window.electronAPI.sendCloseAction) {
                    window.electronAPI.sendCloseAction('exit');
                }
                closeModalWithFocusRestore(closeConfirmationModal);
            };
        }

        // ACTION: Minimize to Tray
        if (closeConfirmTrayBtn) {
            closeConfirmTrayBtn.onclick = () => {
                if (window.electronAPI.sendCloseAction) {
                    window.electronAPI.sendCloseAction('minimize-to-tray');
                }
                closeModalWithFocusRestore(closeConfirmationModal);
            };
        }

        // ACTION: Cancel (Go Back)
        if (closeConfirmCancelBtn) {
            closeConfirmCancelBtn.onclick = () => {
                if (window.electronAPI.sendCloseAction) {
                    window.electronAPI.sendCloseAction('cancel');
                }
                closeModalWithFocusRestore(closeConfirmationModal);
            };
        }

        // Close on outside click (treat as cancel)
        window.onclick = (event) => {
            if (event.target === closeConfirmationModal) {
                if (window.electronAPI.sendCloseAction) {
                    window.electronAPI.sendCloseAction('cancel');
                }
                closeModalWithFocusRestore(closeConfirmationModal);
            }
            // Existing window.onclick logic for other modals...
            const onboardingModal = document.getElementById('onboardingModal');
            if (event.target === onboardingModal) {
                if (window.openOnboarding) {
                    const closeModal = () => {
                        onboardingModal.style.display = 'none';
                        document.body.style.overflow = '';
                        localStorage.setItem('ytdTutorialCompleted', 'true');
                        flushSettingsToDisk();
                    };
                    closeModal();
                }
            }
            const settingsModal = document.getElementById('settingsModal');
            if (event.target === settingsModal) {
                closeModalWithFocusRestore(settingsModal);
            }
            const confirmationModal = document.getElementById('confirmationModal');
            if (event.target === confirmationModal) {
                closeModalWithFocusRestore(confirmationModal);
            }
        };
    }
});
