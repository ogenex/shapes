import { getHistory } from './quiz-engine.js';

async function init() {
    const grid = document.getElementById('topicGrid');
    let manifest;
    try {
        const response = await fetch('data/manifest.json');
        manifest = await response.json();
    } catch (e) {
        grid.innerHTML = '<p class="error-state">Could not load the topic list. Try reloading the page.</p>';
        return;
    }

    grid.innerHTML = manifest
        .map(topic => {
            const history = getHistory(topic.id);
            let lastAttemptHtml = '';
            if (history.length > 0) {
                const last = history[0];
                const pct = Math.round((last.score / last.total) * 100);
                const date = new Date(last.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                lastAttemptHtml = '<div class="last-attempt">Last attempt: ' + pct + '% on ' + date + '</div>';
            }
            return (
                '<a class="topic-card" href="quiz.html?topic=' + encodeURIComponent(topic.id) + '">' +
                '<div class="topic-title">' + topic.title + '<span class="badge">' + topic.questionCount + ' questions</span></div>' +
                '<div class="topic-desc">' + topic.description + '</div>' +
                lastAttemptHtml +
                '</a>'
            );
        })
        .join('');
}

init();
