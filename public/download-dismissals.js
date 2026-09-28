(function (root) {
    function createDownloadDismissals({ storage, clientId, removeRemote }) {
        const key = `gvl_pendingRemovals:${clientId}`;
        let saved;
        try { saved = JSON.parse(storage.getItem(key) || '[]'); } catch (_) { saved = []; }
        const pending = new Set(Array.isArray(saved) ? saved.filter(id => typeof id === 'string') : []);
        const dismissed = new Set(pending);
        let inFlight = null;
        const persist = () => storage.setItem(key, JSON.stringify([...pending]));

        function dismiss(itemId) {
            const alreadyPending = pending.has(itemId);
            pending.add(itemId);
            try { persist(); } catch (error) {
                if (!alreadyPending) pending.delete(itemId);
                throw error;
            }
            dismissed.add(itemId);
        }

        function flush() {
            if (inFlight) return inFlight;
            inFlight = (async () => {
                for (const itemId of [...pending]) {
                    try {
                        await removeRemote(itemId);
                        pending.delete(itemId);
                        try { persist(); } catch (error) {
                            pending.add(itemId);
                            throw error;
                        }
                    } catch (_) {
                        // Keep the dismissal across reloads until the server confirms it.
                    }
                }
                return pending.size;
            })().finally(() => { inFlight = null; });
            return inFlight;
        }

        return { dismissed, dismiss, flush };
    }

    if (typeof module === 'object' && module.exports) module.exports = { createDownloadDismissals };
    else root.createDownloadDismissals = createDownloadDismissals;
})(typeof window === 'undefined' ? globalThis : window);
