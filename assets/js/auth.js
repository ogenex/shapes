// Who is using the site right now.
//
// Two modes:
//   account — signed in with Supabase; progress is stored in the database
//             and visible on any device (and to linked tutors).
//   guest   — no account; progress lives only in this browser, as before.
//
// If Supabase isn't configured (see config.js) everyone is a guest.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const SUPABASE_MODULE = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const GUEST_FLAG = 'naplanQuiz:guest';

export const accountsEnabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let clientPromise = null;

export function getClient() {
    if (!accountsEnabled) return Promise.resolve(null);
    if (!clientPromise) {
        clientPromise = import(SUPABASE_MODULE).then(({ createClient }) =>
            createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
        );
    }
    return clientPromise;
}

function readGuestFlag() {
    try {
        return localStorage.getItem(GUEST_FLAG) === '1';
    } catch (e) {
        return false;
    }
}

export function setGuest(on) {
    try {
        if (on) localStorage.setItem(GUEST_FLAG, '1');
        else localStorage.removeItem(GUEST_FLAG);
    } catch (e) {
        // storage blocked — guest mode just won't be remembered
    }
}

const GUEST_USER = Object.freeze({ mode: 'guest', id: 'guest', displayName: 'Guest', role: 'student' });

export async function getCurrentUser() {
    if (accountsEnabled) {
        let client;
        try {
            client = await getClient();
        } catch (e) {
            // Supabase library couldn't load (offline?) — fall back to guest if chosen before
            return readGuestFlag() ? GUEST_USER : null;
        }
        const { data } = await client.auth.getSession();
        const session = data && data.session;
        if (session) {
            const { data: profile } = await client
                .from('profiles')
                .select('display_name, role, tutor_code')
                .eq('id', session.user.id)
                .maybeSingle();
            return {
                mode: 'account',
                id: session.user.id,
                email: session.user.email,
                displayName: (profile && profile.display_name) || session.user.email,
                role: (profile && profile.role) || 'student',
                tutorCode: (profile && profile.tutor_code) || null,
            };
        }
    }
    if (!accountsEnabled || readGuestFlag()) return GUEST_USER;
    return null;
}

// Page guard: returns the user, or sends them to the login page.
export async function requireUser() {
    const user = await getCurrentUser();
    if (!user) {
        const here = location.pathname.split('/').pop() + location.search;
        location.replace('login.html?next=' + encodeURIComponent(here || 'index.html'));
        return new Promise(() => {}); // never resolves; page is navigating away
    }
    return user;
}

// Only allow redirects to our own pages (no open redirects via ?next=).
export function safeNext(value) {
    return /^[a-z0-9-]+\.html(\?[^#]*)?$/i.test(value || '') ? value : 'index.html';
}

export async function signOut() {
    setGuest(false);
    if (accountsEnabled) {
        try {
            const client = await getClient();
            await client.auth.signOut();
        } catch (e) {
            // ignore — we're leaving anyway
        }
    }
    location.href = 'login.html';
}
