// Progress storage with one interface for both modes.
//
// Attempt shape used everywhere in the UI:
//   { topicId, score, total, missed: [questionText], completedAt: ISO string, pending? }
//
// Guest mode keeps using the original localStorage key (naplanQuiz:v1) so
// anyone who used the site before accounts existed keeps their history.
// Account mode writes completed attempts to Supabase. If a write fails
// (offline, say) the attempt is kept in a local outbox and sent next time.
// In-progress "resume" state is always per-device, keyed per user.

import { getClient } from './auth.js';

const LEGACY_KEY = 'naplanQuiz:v1';
const GUEST_HISTORY_LIMIT = 50;
const MISSED_LIMIT = 50;

function readJson(key, fallback) {
    try {
        return JSON.parse(localStorage.getItem(key)) || fallback;
    } catch (e) {
        return fallback;
    }
}

function writeJson(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
        // storage unavailable (private browsing, quota) — won't persist
    }
}

function fromRow(row) {
    return {
        topicId: row.topic_id,
        score: row.score,
        total: row.total,
        missed: Array.isArray(row.missed) ? row.missed : [],
        completedAt: row.completed_at,
    };
}

function toRow(attempt) {
    return {
        topic_id: attempt.topicId,
        score: attempt.score,
        total: attempt.total,
        missed: (attempt.missed || []).slice(0, MISSED_LIMIT).map(q => String(q).slice(0, 500)),
        completed_at: attempt.completedAt,
    };
}

function byNewest(a, b) {
    return new Date(b.completedAt) - new Date(a.completedAt);
}

// Attempts for one or more users (tutor dashboards use this with student ids).
export async function fetchAttempts(userIds, { limit = 1000 } = {}) {
    if (userIds.length === 0) return [];
    const client = await getClient();
    const { data, error } = await client
        .from('attempts')
        .select('user_id, topic_id, score, total, missed, completed_at')
        .in('user_id', userIds)
        .order('completed_at', { ascending: false })
        .limit(limit);
    if (error) throw error;
    return data.map(row => Object.assign(fromRow(row), { userId: row.user_id }));
}

// ---------------------------------------------------------------------
// Guest store — the original per-topic localStorage layout
// ---------------------------------------------------------------------

function legacyHistoryToAttempts(store) {
    const attempts = [];
    Object.keys(store).forEach(topicId => {
        (store[topicId].history || []).forEach(h => {
            attempts.push({
                topicId,
                score: h.score,
                total: h.total,
                missed: h.missed || [],
                completedAt: h.date,
            });
        });
    });
    return attempts.sort(byNewest);
}

function createGuestStore() {
    const read = () => readJson(LEGACY_KEY, {});
    const topic = (store, id) => (store[id] = store[id] || { resume: null, history: [] });

    return {
        mode: 'guest',
        async listAttempts({ topicId, limit } = {}) {
            let attempts = legacyHistoryToAttempts(read());
            if (topicId) attempts = attempts.filter(a => a.topicId === topicId);
            return limit ? attempts.slice(0, limit) : attempts;
        },
        async recordAttempt(attempt) {
            const store = read();
            const record = topic(store, attempt.topicId);
            record.resume = null;
            record.history = [{
                date: attempt.completedAt,
                score: attempt.score,
                total: attempt.total,
                missed: (attempt.missed || []).slice(0, MISSED_LIMIT),
            }].concat(record.history).slice(0, GUEST_HISTORY_LIMIT);
            writeJson(LEGACY_KEY, store);
            return { saved: true };
        },
        getResume(topicId) {
            return (read()[topicId] || {}).resume || null;
        },
        saveResume(topicId, state) {
            const store = read();
            topic(store, topicId).resume = state;
            writeJson(LEGACY_KEY, store);
        },
        clearResume(topicId) {
            this.saveResume(topicId, null);
        },
        async flushOutbox() {},
    };
}

// ---------------------------------------------------------------------
// Account store — Supabase, with an offline outbox
// ---------------------------------------------------------------------

function createAccountStore(user) {
    const resumeKey = LEGACY_KEY + ':user:' + user.id;
    const outboxKey = 'naplanQuiz:outbox:' + user.id;
    const dismissKey = 'naplanQuiz:importDismissed:' + user.id;

    async function insert(attempts) {
        const client = await getClient();
        const { error } = await client.from('attempts').insert(attempts.map(toRow));
        if (error) throw error;
    }

    return {
        mode: 'account',
        async listAttempts({ topicId, limit = 1000 } = {}) {
            const client = await getClient();
            let query = client
                .from('attempts')
                .select('topic_id, score, total, missed, completed_at')
                .eq('user_id', user.id);
            if (topicId) query = query.eq('topic_id', topicId);
            const { data, error } = await query.order('completed_at', { ascending: false }).limit(limit);
            if (error) throw error;
            let pending = readJson(outboxKey, []).map(a => Object.assign({}, a, { pending: true }));
            if (topicId) pending = pending.filter(a => a.topicId === topicId);
            return pending.concat(data.map(fromRow)).sort(byNewest).slice(0, limit);
        },
        async recordAttempt(attempt) {
            this.clearResume(attempt.topicId);
            try {
                await insert([attempt]);
                return { saved: true };
            } catch (e) {
                writeJson(outboxKey, readJson(outboxKey, []).concat([attempt]));
                return { saved: false };
            }
        },
        async flushOutbox() {
            const outbox = readJson(outboxKey, []);
            if (outbox.length === 0) return;
            try {
                await insert(outbox);
                writeJson(outboxKey, []);
            } catch (e) {
                // still offline — try again next page load
            }
        },
        getResume(topicId) {
            return readJson(resumeKey, {})[topicId] || null;
        },
        saveResume(topicId, state) {
            const all = readJson(resumeKey, {});
            if (state) all[topicId] = state;
            else delete all[topicId];
            writeJson(resumeKey, all);
        },
        clearResume(topicId) {
            this.saveResume(topicId, null);
        },

        // Results saved in this browser before the user had an account.
        guestHistoryCount() {
            if (readJson(dismissKey, false)) return 0;
            return legacyHistoryToAttempts(readJson(LEGACY_KEY, {})).length;
        },
        dismissGuestImport() {
            writeJson(dismissKey, true);
        },
        async importGuestHistory() {
            const attempts = legacyHistoryToAttempts(readJson(LEGACY_KEY, {}));
            if (attempts.length > 0) await insert(attempts);
            this.discardGuestHistory();
            return attempts.length;
        },
        discardGuestHistory() {
            const store = readJson(LEGACY_KEY, {});
            Object.keys(store).forEach(id => (store[id].history = []));
            writeJson(LEGACY_KEY, store);
        },
    };
}

export function createStore(user) {
    return user.mode === 'account' ? createAccountStore(user) : createGuestStore();
}
