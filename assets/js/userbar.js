import { accountsEnabled, signOut } from './auth.js';
import { escapeHtml } from './util.js';

// Small bar at the top of each page: who's signed in + navigation.
export function renderUserBar(user, { active } = {}) {
    const bar = document.getElementById('userBar');
    if (!bar) return;

    const link = (href, label, key) =>
        '<a href="' + href + '"' + (active === key ? ' aria-current="page"' : '') + '>' + label + '</a>';

    const who = user.mode === 'account'
        ? '<span class="userbar-name">' + escapeHtml(user.displayName) +
          (user.role === 'tutor' ? ' <span class="role-tag">Tutor</span>' : '') + '</span>'
        : '<span class="userbar-name">Guest</span><span class="userbar-hint">progress saved on this device only</span>';

    const account = user.mode === 'account'
        ? '<button type="button" class="linklike" id="signOutButton">Sign out</button>'
        : accountsEnabled
            ? '<button type="button" class="linklike" id="signOutButton">Sign in</button>'
            : '';

    bar.innerHTML =
        '<div class="userbar-who">' + who + '</div>' +
        '<nav class="userbar-nav">' +
        link('index.html', 'Topics', 'topics') +
        link('dashboard.html', user.role === 'tutor' ? 'Students' : 'My progress', 'dashboard') +
        account +
        '</nav>';

    const button = document.getElementById('signOutButton');
    if (button) button.onclick = signOut;
}
