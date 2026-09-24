import { requireUser } from './auth.js';
import { createStore } from './store.js';
import { renderUserBar } from './userbar.js';
import { escapeHtml, percent, shortDate, loadManifest } from './util.js';

async function init() {
    const grid = document.getElementById('topicGrid');
    const user = await requireUser();
    renderUserBar(user, { active: 'topics' });

    const store = createStore(user);
    await store.flushOutbox();

    document.getElementById('subtitle').textContent = user.mode === 'account'
        ? 'Pick a topic to practise — your progress is saved to your account'
        : 'Pick a topic to practise — your progress is saved on this device';

    let manifest;
    try {
        manifest = await loadManifest();
    } catch (e) {
        grid.innerHTML = '<p class="error-state">Could not load the topic list. Try reloading the page.</p>';
        return;
    }

    let attempts = [];
    try {
        attempts = await store.listAttempts();
    } catch (e) {
        // progress couldn't load (offline?) — still show topics
    }
    const latestByTopic = {};
    attempts.forEach(a => {
        if (!latestByTopic[a.topicId]) latestByTopic[a.topicId] = a;
    });

    grid.innerHTML = manifest
        .map(topic => {
            const last = latestByTopic[topic.id];
            const lastAttemptHtml = last
                ? '<div class="last-attempt">Last attempt: ' + percent(last.score, last.total) + '% on ' + shortDate(last.completedAt) + '</div>'
                : '';
            return (
                '<a class="topic-card" href="quiz.html?topic=' + encodeURIComponent(topic.id) + '">' +
                '<div class="topic-title">' + escapeHtml(topic.title) + '<span class="badge">' + topic.questionCount + ' questions</span></div>' +
                '<div class="topic-desc">' + escapeHtml(topic.description) + '</div>' +
                lastAttemptHtml +
                '</a>'
            );
        })
        .join('');
}

init();
