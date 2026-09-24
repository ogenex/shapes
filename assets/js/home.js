import { requireUser } from './auth.js';
import { createStore } from './store.js';
import { renderUserBar } from './userbar.js';
import { escapeHtml, percent, relativeDay, loadManifest } from './util.js';

// Topic accent colours — a colour-blind-checked categorical set, assigned
// in manifest.json ("color"). `ink` is the icon colour that reads on it.
const COLORS = {
    blue:    { hex: '#2a78d6', ink: '#ffffff' },
    orange:  { hex: '#eb6834', ink: '#ffffff' },
    aqua:    { hex: '#1baf7a', ink: '#10231b' },
    yellow:  { hex: '#eda100', ink: '#2b1d00' },
    magenta: { hex: '#e87ba4', ink: '#2b0f1a' },
    green:   { hex: '#008300', ink: '#ffffff' },
    violet:  { hex: '#4a3aa7', ink: '#ffffff' },
    red:     { hex: '#e34948', ink: '#ffffff' },
};
const FALLBACK_ORDER = ['blue', 'orange', 'aqua', 'yellow', 'magenta', 'green', 'violet', 'red'];
const NEUTRAL = { hex: '#6b6a66', ink: '#ffffff' };

// 24×24 line icons, keyed by manifest "icon"
const ICONS = {
    pie: '<circle cx="12" cy="12" r="9"/><path d="M12 3v9h9"/>',
    scale: '<path d="M12 4v16M8 20h8M4 7h16"/><path d="M7 7l-3 6h6zM17 7l-3 6h6z"/>',
    variable: '<path d="M4 9l8 10M12 9l-8 10"/><path d="M15 6.2a2 2 0 1 1 3.4 1.5L15 11h4"/>',
    ruler: '<rect x="2.5" y="7.5" width="19" height="9" rx="1.5"/><path d="M6.5 7.5v3M10 7.5v4.5M13.5 7.5v3M17 7.5v4.5"/>',
    shapes: '<path d="M3 20h11L8.5 9z"/><circle cx="16.5" cy="8" r="4.5"/>',
    bars: '<path d="M4 20h16"/><path d="M7 20v-6M12 20V6M17 20v-10"/>',
    coin: '<circle cx="12" cy="12" r="9"/><path d="M14.8 9.3c-.5-.9-1.5-1.3-2.8-1.3-1.6 0-2.8.8-2.8 1.9 0 2.6 5.6 1.4 5.6 4.2 0 1.1-1.2 1.9-2.8 1.9-1.4 0-2.4-.5-2.9-1.4M12 6.5v11"/>',
    book: '<path d="M4 5h6a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H4zM20 5h-6a2 2 0 0 0-2 2v12a2 2 0 0 1 2-2h6z"/>',
};

function icon(name) {
    return '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || ICONS.book) + '</svg>';
}

function colourFor(topic, index) {
    return COLORS[topic.color] || COLORS[FALLBACK_ORDER[index]] || NEUTRAL;
}

function status(latestPct) {
    if (latestPct == null) return { cls: 'new', label: 'Not started' };
    if (latestPct >= 80) return { cls: 'good', label: 'Strong' };
    if (latestPct >= 60) return { cls: 'warning', label: 'Getting there' };
    return { cls: 'critical', label: 'Needs work' };
}

// Progress ring: latest score as an arc on a tinted track, number in the middle
function ring(pct) {
    const r = 26;
    const c = 2 * Math.PI * r;
    const arc = pct == null ? '' :
        '<circle class="ring-arc" cx="32" cy="32" r="' + r + '" stroke-dasharray="' +
        (c * pct / 100).toFixed(1) + ' ' + c.toFixed(1) + '"/>';
    return '<div class="ring" role="img" aria-label="' + (pct == null ? 'Not started' : 'Latest score ' + pct + '%') + '">' +
        '<svg viewBox="0 0 64 64" width="72" height="72"><circle class="ring-track" cx="32" cy="32" r="' + r + '"/>' + arc + '</svg>' +
        '<span class="ring-value">' + (pct == null ? '—' : pct + '<small>%</small>') + '</span></div>';
}

function stat(label, value) {
    return '<div class="stat"><div class="stat-value">' + value + '</div><div class="stat-label">' + label + '</div></div>';
}

function summarise(attempts) {
    const t = { attempts, count: attempts.length };
    if (!attempts.length) return t;
    const scored = attempts.reduce((n, a) => n + a.score, 0);
    const asked = attempts.reduce((n, a) => n + a.total, 0);
    t.latest = attempts[0];
    t.latestPct = percent(t.latest.score, t.latest.total);
    t.average = percent(scored, asked);
    t.best = Math.max(...attempts.map(a => percent(a.score, a.total)));
    return t;
}

function renderCard(topic, index, summary, resume) {
    const colour = colourFor(topic, index);
    const s = status(summary.latestPct);
    const inProgress = resume && resume.currentIndex < resume.questions.length;
    const dash = '<span class="muted">—</span>';

    const chip = inProgress
        ? '<span class="chip progress">In progress</span>'
        : '<span class="chip ' + s.cls + '">' + s.label + '</span>';

    const foot = inProgress
        ? '<div class="resume">' +
            '<div class="resume-text">Question ' + (resume.currentIndex + 1) + ' of ' + resume.questions.length + '</div>' +
            '<div class="resume-bar"><span style="width:' +
            Math.round((resume.currentIndex / resume.questions.length) * 100) + '%"></span></div></div>'
        : '<span class="foot-meta">' + (summary.count
            ? 'Last practised ' + relativeDay(summary.latest.completedAt).toLowerCase()
            : topic.questionCount + ' questions') + '</span>';

    const cta = inProgress ? 'Resume' : summary.count ? 'Practise again' : 'Start';

    return (
        '<a class="topic-card" href="quiz.html?topic=' + encodeURIComponent(topic.id) + '" ' +
        'style="--c:' + colour.hex + ';--c-ink:' + colour.ink + '">' +
        '<div class="card-top"><span class="icon-badge">' + icon(topic.icon) + '</span>' + chip + '</div>' +
        '<h2 class="card-title">' + escapeHtml(topic.title) + '</h2>' +
        '<p class="card-desc">' + escapeHtml(topic.description) + '</p>' +
        '<div class="card-progress">' + ring(summary.latestPct) +
        '<div class="stats">' +
        stat(summary.count === 1 ? 'Attempt' : 'Attempts', summary.count) +
        stat('Average', summary.count ? summary.average + '%' : dash) +
        stat('Best', summary.count ? summary.best + '%' : dash) +
        '</div></div>' +
        '<div class="card-foot">' + foot + '<span class="cta">' + cta + ' <span aria-hidden="true">→</span></span></div>' +
        '</a>'
    );
}

// Which topic to nudge towards, with a reason
function pickNext(manifest, summaries, resumes) {
    const resumeTopic = manifest.find(t => resumes[t.id]);
    if (resumeTopic) {
        const r = resumes[resumeTopic.id];
        return { topic: resumeTopic, cta: 'Resume',
            text: 'Pick up where you left off — question ' + (r.currentIndex + 1) + ' of ' + r.questions.length + '.' };
    }
    const tried = manifest.filter(t => summaries[t.id].count);
    if (!tried.length) return null;
    const weakest = tried.slice().sort((a, b) => summaries[a.id].latestPct - summaries[b.id].latestPct)[0];
    const weakPct = summaries[weakest.id].latestPct;
    if (weakPct < 60) {
        return { topic: weakest, cta: 'Try again',
            text: 'Your latest score here was ' + weakPct + '%. Another go with the explanations fresh in mind will help it stick.' };
    }
    const untried = manifest.find(t => !summaries[t.id].count);
    if (untried) {
        return { topic: untried, cta: 'Start',
            text: 'You haven\'t tried this topic yet — ' + untried.questionCount + ' questions with worked explanations.' };
    }
    return { topic: weakest, cta: 'Practise',
        text: 'Everything\'s looking solid. Your lowest latest score is ' + weakPct + '% here — worth another round.' };
}

function renderHero(user, manifest, summaries, attempts) {
    const first = user.mode === 'account' ? user.displayName.split(/\s+/)[0] : null;
    document.getElementById('greeting').textContent = attempts.length
        ? 'Welcome back' + (first ? ', ' + first : '')
        : 'Welcome' + (first ? ', ' + first : '');
    document.getElementById('subtitle').textContent = attempts.length
        ? 'Pick up a topic below — every question comes with a worked explanation.'
        : 'Choose any topic to start. Every question comes with a worked explanation.';

    if (!attempts.length) return;
    const asked = attempts.reduce((n, a) => n + a.total, 0);
    const scored = attempts.reduce((n, a) => n + a.score, 0);
    const started = manifest.filter(t => summaries[t.id].count).length;
    const weekAgo = Date.now() - 7 * 86400000;
    const thisWeek = attempts.filter(a => new Date(a.completedAt) >= weekAgo).length;
    const tile = (label, value, sub) =>
        '<div class="hero-stat"><div class="hero-value">' + value + '</div><div class="hero-label">' + label + '</div>' +
        (sub ? '<div class="hero-sub">' + sub + '</div>' : '') + '</div>';
    const el = document.getElementById('heroStats');
    el.innerHTML =
        tile('Quizzes completed', attempts.length, thisWeek ? thisWeek + ' this week' : '') +
        tile('Average score', percent(scored, asked) + '%', asked.toLocaleString() + ' questions') +
        tile('Topics started', started + '<small>/' + manifest.length + '</small>', '');
    el.classList.remove('hidden');
}

function renderNext(next, index) {
    const el = document.getElementById('nextUp');
    if (!next) return;
    const colour = colourFor(next.topic, index);
    el.setAttribute('style', '--c:' + colour.hex + ';--c-ink:' + colour.ink);
    el.innerHTML =
        '<span class="icon-badge">' + icon(next.topic.icon) + '</span>' +
        '<div class="next-body"><div class="next-label">Suggested next</div>' +
        '<div class="next-title">' + escapeHtml(next.topic.title) + '</div>' +
        '<div class="next-text">' + escapeHtml(next.text) + '</div></div>' +
        '<a class="button primary next-cta" href="quiz.html?topic=' + encodeURIComponent(next.topic.id) + '">' +
        next.cta + ' →</a>';
    el.classList.remove('hidden');
}

async function init() {
    const grid = document.getElementById('topicGrid');
    const user = await requireUser();
    renderUserBar(user, { active: 'topics' });

    const store = createStore(user);
    await store.flushOutbox();

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
    attempts = attempts.filter(a => manifest.some(t => t.id === a.topicId));

    const summaries = {};
    const resumes = {};
    manifest.forEach(t => {
        summaries[t.id] = summarise(attempts.filter(a => a.topicId === t.id));
        const r = store.getResume(t.id);
        if (r && r.currentIndex > 0 && r.currentIndex < r.questions.length) resumes[t.id] = r;
    });

    renderHero(user, manifest, summaries, attempts);
    const next = pickNext(manifest, summaries, resumes);
    if (next) renderNext(next, manifest.indexOf(next.topic));

    grid.innerHTML = manifest.map((t, i) => renderCard(t, i, summaries[t.id], resumes[t.id])).join('');
}

init();
