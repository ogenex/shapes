import { requireUser, getClient, accountsEnabled } from './auth.js';
import { createStore, fetchAttempts } from './store.js';
import { renderUserBar } from './userbar.js';
import { escapeHtml, percent, shortDate, relativeDay, loadManifest } from './util.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);

// ---------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------

function showError(text) {
    $('loadingState').classList.add('hidden');
    $('errorState').textContent = text;
    $('errorState').classList.remove('hidden');
}

function shortTopicName(title) {
    return title.split(/[\s,&]+/)[0];
}

function status(latestPct) {
    if (latestPct == null) return { cls: '', label: 'Not started' };
    if (latestPct >= 80) return { cls: 'good', label: 'Strong' };
    if (latestPct >= 60) return { cls: 'warning', label: 'Getting there' };
    return { cls: 'critical', label: 'Needs work' };
}

const BINS = [
    { cls: 'b1', label: 'Under 40%', test: p => p < 40 },
    { cls: 'b2', label: '40–59%', test: p => p < 60 },
    { cls: 'b3', label: '60–79%', test: p => p < 80 },
    { cls: 'b4', label: '80–89%', test: p => p < 90 },
    { cls: 'b5', label: '90%+', test: () => true },
];

function binFor(p) {
    return BINS.find(b => b.test(p)).cls;
}

// attempts are newest-first; returns per-topic summaries keyed by topic id
function summariseByTopic(attempts) {
    const byTopic = {};
    attempts.forEach(a => {
        const t = (byTopic[a.topicId] = byTopic[a.topicId] || { attempts: [], best: 0 });
        t.attempts.push(a);
        t.best = Math.max(t.best, percent(a.score, a.total));
    });
    Object.values(byTopic).forEach(t => {
        t.latest = t.attempts[0];
        t.latestPct = percent(t.latest.score, t.latest.total);
    });
    return byTopic;
}

// Hover/focus tooltip for any element with data-tip
function wireTooltips(root) {
    if (root.dataset.tipsWired) return;
    root.dataset.tipsWired = '1';
    const tip = $('tooltip');
    const place = (target) => {
        const rect = target.getBoundingClientRect();
        tip.classList.remove('hidden');
        const w = tip.offsetWidth;
        const h = tip.offsetHeight;
        let left = rect.left + rect.width / 2 - w / 2;
        left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
        let top = rect.top - h - 8;
        if (top < 8) top = rect.bottom + 8;
        tip.style.left = left + 'px';
        tip.style.top = top + 'px';
    };
    const showFor = event => {
        const target = event.target.closest('[data-tip]');
        if (!target || !root.contains(target)) return;
        tip.textContent = target.getAttribute('data-tip');
        place(target);
    };
    let active = null;
    const hide = () => {
        tip.classList.add('hidden');
        if (active) active.classList.remove('active');
        active = null;
    };
    root.addEventListener('mouseover', showFor);
    root.addEventListener('focusin', showFor);
    root.addEventListener('mouseout', event => { if (!active) hide(); });
    root.addEventListener('focusout', event => { if (!active) hide(); });
    // Touch screens have no hover: tap a cell or point to show its details,
    // tap it again (or anywhere else) to hide them.
    root.addEventListener('click', event => {
        const target = event.target.closest('[data-tip]');
        if (!target || !root.contains(target)) return;
        if (active === target) return hide();
        hide();
        active = target;
        target.classList.add('active');
        showFor(event);
    });
    document.addEventListener('click', event => {
        if (active && !root.contains(event.target)) hide();
    });
    window.addEventListener('scroll', hide, { passive: true });
}

// Show a "swipe" hint and edge shadow when a table is wider than its panel
function markScrollable(scroller) {
    const update = () => scroller.classList.toggle('scrollable', scroller.scrollWidth > scroller.clientWidth + 2);
    update();
    if (!scroller.dataset.watch) {
        scroller.dataset.watch = '1';
        window.addEventListener('resize', update);
    }
}

// Tiny single-series line of percentage scores, oldest → newest
function sparkline(attempts, topicTitle) {
    const points = attempts.slice(0, 10).reverse();
    const W = 120, H = 32, PAD = 5;
    const x = i => points.length === 1 ? W / 2 : PAD + (i * (W - 2 * PAD)) / (points.length - 1);
    const y = p => PAD + ((100 - p) * (H - 2 * PAD)) / 100;
    const pcts = points.map(a => percent(a.score, a.total));
    const path = pcts.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p).toFixed(1)).join(' ');
    const last = pcts.length - 1;

    const hits = pcts.map((p, i) => {
        const a = points[i];
        const tip = topicTitle + ' — ' + p + '% (' + a.score + '/' + a.total + ') on ' + shortDate(a.completedAt);
        const isLast = i === last;
        return '<circle class="hit" cx="' + x(i) + '" cy="' + y(p) + '" r="8" tabindex="0" data-tip="' + escapeHtml(tip) + '"></circle>' +
            '<circle class="dot" cx="' + x(i) + '" cy="' + y(p) + '" r="' + (isLast ? 4 : 0) + '"></circle>';
    }).join('');

    return '<svg class="spark" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" ' +
        'aria-label="' + escapeHtml('Last ' + pcts.length + ' scores: ' + pcts.join('%, ') + '%') + '">' +
        '<line class="ref" x1="0" x2="' + W + '" y1="' + y(80) + '" y2="' + y(80) + '"></line>' +
        (pcts.length > 1 ? '<path class="line" d="' + path + '"></path>' : '') +
        hits + '</svg>';
}

// ---------------------------------------------------------------------
// Student view — own progress, or a linked student's for a tutor
// ---------------------------------------------------------------------

function renderStudent({ name, subtitlePrefix, attempts, manifest, ownView }) {
    const topicsById = Object.fromEntries(manifest.map(t => [t.id, t]));
    attempts = attempts.filter(a => topicsById[a.topicId]);
    const byTopic = summariseByTopic(attempts);

    $('studentName').textContent = name;
    const lastActive = attempts[0] ? 'Last practised ' + relativeDay(attempts[0].completedAt).toLowerCase() : 'No practice yet';
    const weekAgo = Date.now() - 7 * 86400000;
    const activeDays = new Set(
        attempts.filter(a => new Date(a.completedAt) >= weekAgo).map(a => new Date(a.completedAt).toDateString())
    ).size;
    $('studentSub').textContent = [subtitlePrefix, lastActive,
        activeDays ? activeDays + (activeDays === 1 ? ' day' : ' days') + ' active this week' : null]
        .filter(Boolean).join(' · ');

    // Tiles
    const answered = attempts.reduce((n, a) => n + a.total, 0);
    const correct = attempts.reduce((n, a) => n + a.score, 0);
    const practised = Object.keys(byTopic).length;
    const tile = (label, value, sub) =>
        '<div class="tile"><div class="tile-label">' + label + '</div><div class="tile-value">' + value + '</div>' +
        (sub ? '<div class="tile-sub">' + sub + '</div>' : '') + '</div>';
    $('tiles').innerHTML =
        tile('Quizzes completed', attempts.length.toLocaleString()) +
        tile('Questions answered', answered.toLocaleString(), answered ? correct.toLocaleString() + ' correct' : '') +
        tile('Average score', answered ? percent(correct, answered) + '%' : '—', answered ? 'across all attempts' : '') +
        tile('Topics practised', practised + '<small> / ' + manifest.length + '</small>',
            practised < manifest.length && practised > 0 ? (manifest.length - practised) + ' still to try' : '');

    // Topic table
    $('topicTable').innerHTML =
        '<thead><tr><th>Topic</th><th>Status</th><th class="num">Latest</th><th class="num hide-sm">Best</th>' +
        '<th class="num hide-sm">Attempts</th><th>Recent scores</th>' + (ownView ? '<th></th>' : '') + '</tr></thead><tbody>' +
        manifest.map(topic => {
            const t = byTopic[topic.id];
            const s = status(t ? t.latestPct : null);
            return '<tr>' +
                '<td><span class="topic-name">' + escapeHtml(topic.title) + '</span></td>' +
                '<td><span class="status ' + s.cls + '">' + s.label + '</span></td>' +
                '<td class="num latest-cell">' + (t ? t.latestPct + '%' : '<span class="muted">—</span>') + '</td>' +
                '<td class="num hide-sm">' + (t ? t.best + '%' : '<span class="muted">—</span>') + '</td>' +
                '<td class="num hide-sm">' + (t ? t.attempts.length : 0) + '</td>' +
                '<td>' + (t ? sparkline(t.attempts, topic.title) : '<span class="muted">No attempts yet</span>') + '</td>' +
                (ownView ? '<td><a class="practise" href="quiz.html?topic=' + encodeURIComponent(topic.id) + '">Practise →</a></td>' : '') +
                '</tr>';
        }).join('') + '</tbody>';
    wireTooltips($('topicTable'));

    // Recent activity
    const recent = attempts.slice(0, 8);
    $('recentList').innerHTML = recent.length === 0
        ? '<p class="empty">No quizzes completed yet.' + (ownView ? ' <a href="index.html">Pick a topic</a> to get started.' : '') + '</p>'
        : '<ul class="list">' + recent.map(a =>
            '<li><div><div class="primary">' + escapeHtml(topicsById[a.topicId].title) +
            (a.pending ? '<span class="pending-tag">not synced yet</span>' : '') + '</div>' +
            '<div class="secondary">' + relativeDay(a.completedAt) + '</div></div>' +
            '<div class="value"><strong>' + percent(a.score, a.total) + '%</strong>' +
            '<div class="secondary">' + a.score + ' / ' + a.total + '</div></div></li>'
        ).join('') + '</ul>';

    // Most-missed questions across the last 30 attempts
    const counts = new Map();
    attempts.slice(0, 30).forEach(a => {
        (a.missed || []).forEach(q => {
            const key = a.topicId + '\u0000' + q;
            counts.set(key, (counts.get(key) || 0) + 1);
        });
    });
    const missed = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    $('missedList').innerHTML = missed.length === 0
        ? '<p class="empty">' + (attempts.length ? 'Nothing missed recently — nice work.' : 'Missed questions will show up here.') + '</p>'
        : '<ul class="list">' + missed.map(([key, n]) => {
            const [topicId, q] = key.split('\u0000');
            return '<li><div><div class="primary missed-q">' + escapeHtml(q) + '</div>' +
                '<div class="secondary">' + escapeHtml(topicsById[topicId].title) + '</div></div>' +
                '<div class="value secondary">' + (n > 1 ? 'missed ' + n + '×' : 'missed once') + '</div></li>';
        }).join('') + '</ul>';

    $('loadingState').classList.add('hidden');
    $('studentView').classList.remove('hidden');
}

// ---------------------------------------------------------------------
// Sharing with tutors (student's own account view)
// ---------------------------------------------------------------------

async function renderSharing(user) {
    const client = await getClient();
    const panel = $('sharingPanel');
    panel.classList.remove('hidden');

    const message = (text, kind) => {
        const el = $('linkMessage');
        el.textContent = text;
        el.className = 'form-message ' + kind;
    };

    async function refresh() {
        const { data: links, error } = await client
            .from('tutor_links').select('tutor_id').eq('student_id', user.id);
        if (error) {
            $('tutorList').innerHTML = '<p class="empty">Couldn\'t load who you\'re sharing with.</p>';
            return;
        }
        const ids = links.map(l => l.tutor_id);
        let tutors = [];
        if (ids.length) {
            const { data } = await client.from('profiles').select('id, display_name').in('id', ids);
            tutors = data || [];
        }
        $('tutorList').innerHTML = tutors.map(t =>
            '<div class="tutor-row"><span>Sharing with <strong>' + escapeHtml(t.display_name) + '</strong></span>' +
            '<button type="button" class="linklike remove-btn" data-unlink="' + escapeHtml(t.id) + '">Stop sharing</button></div>'
        ).join('');
    }

    $('tutorList').addEventListener('click', async event => {
        const button = event.target.closest('[data-unlink]');
        if (!button) return;
        if (!button.classList.contains('confirming')) {
            button.classList.add('confirming');
            button.textContent = 'Click again to stop sharing';
            return;
        }
        button.disabled = true;
        const { error } = await client.from('tutor_links').delete()
            .eq('student_id', user.id).eq('tutor_id', button.getAttribute('data-unlink'));
        if (error) message('Couldn\'t stop sharing. Please try again.', 'error');
        await refresh();
    });

    $('linkForm').onsubmit = async event => {
        event.preventDefault();
        const input = event.target.code;
        const code = input.value.trim().toUpperCase();
        if (!code) return message('Enter the code your tutor or parent gave you.', 'error');
        const button = event.target.querySelector('button');
        button.disabled = true;
        const { data, error } = await client.rpc('link_to_tutor', { code });
        button.disabled = false;
        if (error) {
            const msg = /no tutor found/i.test(error.message) ? 'That code didn\'t match a tutor. Check it and try again.'
                : /yourself/i.test(error.message) ? 'That\'s your own code.'
                : 'Couldn\'t share right now. Please try again.';
            return message(msg, 'error');
        }
        const tutorName = Array.isArray(data) && data[0] ? data[0].display_name : 'your tutor';
        input.value = '';
        message('Done — ' + tutorName + ' can now see your progress.', 'ok');
        await refresh();
    };

    await refresh();
}

function offerGuestImport(store, reload) {
    const count = store.guestHistoryCount();
    if (!count) return;
    $('importText').textContent = 'We found ' + count + (count === 1 ? ' result' : ' results') +
        ' saved in this browser from before you signed in. Add them to your account?';
    $('importBanner').classList.remove('hidden');
    $('importButton').onclick = async () => {
        $('importButton').disabled = true;
        try {
            await store.importGuestHistory();
            $('importBanner').classList.add('hidden');
            reload();
        } catch (e) {
            $('importButton').disabled = false;
            $('importText').textContent = 'Couldn\'t import right now — check your connection and try again.';
        }
    };
    $('importDismiss').onclick = () => {
        store.dismissGuestImport();
        $('importBanner').classList.add('hidden');
    };
}

// ---------------------------------------------------------------------
// Tutor overview
// ---------------------------------------------------------------------

async function renderTutor(user, manifest) {
    const client = await getClient();
    $('tutorCode').textContent = user.tutorCode || '——————';

    $('copyCode').onclick = async () => {
        try {
            await navigator.clipboard.writeText($('tutorCode').textContent);
            $('codeNote').textContent = 'Copied.';
        } catch (e) {
            $('codeNote').textContent = 'Select the code and copy it manually.';
        }
    };
    $('newCode').onclick = async () => {
        const button = $('newCode');
        if (!button.classList.contains('confirming')) {
            button.classList.add('confirming');
            button.textContent = 'Confirm new code';
            $('codeNote').textContent = 'The old code will stop working for new students. Students already linked stay linked.';
            return;
        }
        button.disabled = true;
        const { data, error } = await client.rpc('regenerate_tutor_code');
        button.disabled = false;
        button.classList.remove('confirming');
        button.textContent = 'Get a new code';
        if (error) {
            $('codeNote').textContent = 'Couldn\'t create a new code. Please try again.';
            return;
        }
        $('tutorCode').textContent = data;
        $('codeNote').textContent = 'New code ready.';
    };

    async function loadStudents() {
        const { data: links, error } = await client
            .from('tutor_links').select('student_id, created_at').eq('tutor_id', user.id);
        if (error) throw error;
        const ids = links.map(l => l.student_id);
        if (ids.length === 0) return [];
        const [{ data: profiles, error: pErr }, attemptLists] = await Promise.all([
            client.from('profiles').select('id, display_name').in('id', ids),
            Promise.all(ids.map(id => fetchAttempts([id]))),
        ]);
        if (pErr) throw pErr;
        const attemptsById = Object.fromEntries(ids.map((id, i) => [id, attemptLists[i]]));
        return profiles
            .map(p => ({ id: p.id, name: p.display_name, attempts: attemptsById[p.id] || [] }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    async function draw() {
        const students = await loadStudents();
        $('studentsEmpty').classList.toggle('hidden', students.length > 0);
        $('heatmapWrap').classList.toggle('hidden', students.length === 0);
        if (students.length === 0) return;

        $('heatLegend').innerHTML = '<span>Latest score:</span>' +
            BINS.map(b => '<span class="legend-item"><span class="swatch ' + b.cls + '"></span>' + b.label + '</span>').join('') +
            '<span class="legend-item"><span class="swatch none"></span>Not tried</span>';

        $('heatmap').innerHTML =
            '<thead><tr><th class="left">Student</th>' +
            manifest.map(t => '<th title="' + escapeHtml(t.title) + '">' + escapeHtml(shortTopicName(t.title)) + '</th>').join('') +
            '<th class="hide-sm">Quizzes</th><th class="hide-sm">Last active</th><th></th></tr></thead><tbody>' +
            students.map(s => {
                const byTopic = summariseByTopic(s.attempts.filter(a => manifest.some(t => t.id === a.topicId)));
                const cells = manifest.map(topic => {
                    const t = byTopic[topic.id];
                    if (!t) {
                        return '<td><div class="cell none" tabindex="0" data-tip="' +
                            escapeHtml(s.name + ' — ' + topic.title + ': not tried yet') + '">—</div></td>';
                    }
                    const tip = s.name + ' — ' + topic.title + ': latest ' + t.latestPct + '% (' + t.latest.score + '/' +
                        t.latest.total + ') on ' + shortDate(t.latest.completedAt) + ' · best ' + t.best + '% · ' +
                        t.attempts.length + (t.attempts.length === 1 ? ' attempt' : ' attempts');
                    return '<td><div class="cell ' + binFor(t.latestPct) + '" tabindex="0" data-tip="' + escapeHtml(tip) + '">' +
                        t.latestPct + '%</div></td>';
                }).join('');
                const last = s.attempts[0];
                return '<tr>' +
                    '<td class="left"><a class="student-link" href="dashboard.html?student=' + encodeURIComponent(s.id) + '">' +
                    escapeHtml(s.name) + '</a></td>' + cells +
                    '<td class="meta hide-sm">' + s.attempts.length + '</td>' +
                    '<td class="meta hide-sm">' + (last ? relativeDay(last.completedAt) : '—') + '</td>' +
                    '<td><button type="button" class="linklike remove-btn" data-remove="' + escapeHtml(s.id) + '" ' +
                    'aria-label="' + escapeHtml('Remove ' + s.name) + '">Remove</button></td>' +
                    '</tr>';
            }).join('') + '</tbody>';
        markScrollable($('heatmap').parentElement);
    }

    $('heatmap').addEventListener('click', async event => {
        const button = event.target.closest('[data-remove]');
        if (!button) return;
        if (!button.classList.contains('confirming')) {
            button.classList.add('confirming');
            button.textContent = 'Confirm';
            return;
        }
        button.disabled = true;
        await client.from('tutor_links').delete()
            .eq('tutor_id', user.id).eq('student_id', button.getAttribute('data-remove'));
        await draw();
    });
    wireTooltips($('heatmap'));

    await draw();
    $('loadingState').classList.add('hidden');
    $('tutorView').classList.remove('hidden');
    markScrollable($('heatmap').parentElement); // measure now that it's visible
}

// ---------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------

async function init() {
    const user = await requireUser();
    renderUserBar(user, { active: 'dashboard' });

    let manifest;
    try {
        manifest = await loadManifest();
    } catch (e) {
        return showError('Could not load the topic list. Try reloading the page.');
    }

    const studentId = params.get('student');
    const isTutor = user.mode === 'account' && user.role === 'tutor';

    try {
        if (isTutor && studentId) {
            const client = await getClient();
            const { data: profile } = await client
                .from('profiles').select('id, display_name').eq('id', studentId).maybeSingle();
            if (!profile || profile.id === user.id) {
                return showError('That student isn\'t linked to your account.');
            }
            $('backToStudents').classList.remove('hidden');
            document.title = profile.display_name + ' — Maths Practice';
            renderStudent({
                name: profile.display_name,
                subtitlePrefix: 'Student progress',
                attempts: await fetchAttempts([profile.id]),
                manifest,
                ownView: false,
            });
            return;
        }

        if (isTutor && params.get('view') !== 'me') {
            await renderTutor(user, manifest);
            return;
        }

        const store = createStore(user);
        await store.flushOutbox();
        const draw = async () => renderStudent({
            name: user.mode === 'account' ? user.displayName : 'My progress',
            subtitlePrefix: isTutor ? 'Your own practice' : null,
            attempts: await store.listAttempts(),
            manifest,
            ownView: true,
        });
        await draw();

        if (isTutor) {
            $('backToStudents').classList.remove('hidden');
        }
        if (user.mode === 'account') {
            offerGuestImport(store, draw);
            if (!isTutor) await renderSharing(user);
        } else if (accountsEnabled) {
            $('guestNote').classList.remove('hidden');
        }
    } catch (e) {
        console.error(e);
        showError('Couldn\'t load progress. Check your internet connection and reload the page.');
    }
}

init();
