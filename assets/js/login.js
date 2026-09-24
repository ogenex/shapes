import { accountsEnabled, getClient, setGuest, safeNext } from './auth.js';

const params = new URLSearchParams(location.search);
const next = safeNext(params.get('next'));

const $ = id => document.getElementById(id);
const forms = ['signInForm', 'signUpForm', 'forgotForm', 'resetForm'];

function show(formId) {
    forms.forEach(id => $(id).classList.toggle('hidden', id !== formId));
    const onSignUp = formId === 'signUpForm';
    $('tabSignIn').setAttribute('aria-selected', String(!onSignUp));
    $('tabSignUp').setAttribute('aria-selected', String(onSignUp));
    clearMessage();
}

function showMessage(text, kind = 'error') {
    const el = $('message');
    el.textContent = text;
    el.className = 'message ' + kind;
}

function clearMessage() {
    $('message').className = 'message hidden';
}

function busy(form, on) {
    form.querySelectorAll('button, input').forEach(el => (el.disabled = on));
}

function friendlyError(error) {
    const msg = (error && error.message) || '';
    if (/invalid login credentials/i.test(msg)) return 'That email and password don\'t match. Check them and try again.';
    if (/email not confirmed/i.test(msg)) return 'Please confirm your email first — check your inbox for the link.';
    if (/already registered/i.test(msg)) return 'There\'s already an account with that email. Try signing in instead.';
    if (/password/i.test(msg) && /characters/i.test(msg)) return 'Your password needs to be at least 6 characters.';
    if (/fetch|network/i.test(msg)) return 'Couldn\'t reach the server. Check your internet connection and try again.';
    return msg || 'Something went wrong. Please try again.';
}

function pageUrl(file) {
    return new URL(file, location.href).href;
}

async function init() {
    $('loadingState').classList.add('hidden');

    if (!accountsEnabled) {
        $('notConfigured').classList.remove('hidden');
        return;
    }
    $('authViews').classList.remove('hidden');

    let client;
    try {
        client = await getClient();
    } catch (e) {
        showMessage('Couldn\'t load the sign-in service. Check your connection, or continue without an account.');
        forms.forEach(id => busy($(id), true));
        wireGuest();
        return;
    }

    // Arriving from a password-reset email.
    let recovering = params.get('reset') === '1';
    client.auth.onAuthStateChange(event => {
        if (event === 'PASSWORD_RECOVERY') {
            recovering = true;
            show('resetForm');
        }
    });

    const { data } = await client.auth.getSession();
    if (recovering && data.session) {
        show('resetForm');
    } else if (data.session) {
        setGuest(false);
        location.replace(next);
        return;
    }

    $('tabSignIn').onclick = () => show('signInForm');
    $('tabSignUp').onclick = () => show('signUpForm');
    $('forgotLink').onclick = () => show('forgotForm');
    $('backToSignIn').onclick = () => show('signInForm');
    wireGuest();

    $('signInForm').onsubmit = async event => {
        event.preventDefault();
        const form = event.target;
        const email = form.email.value.trim();
        const password = form.password.value;
        if (!email || !password) return showMessage('Enter your email and password.');
        busy(form, true);
        const { error } = await client.auth.signInWithPassword({ email, password });
        busy(form, false);
        if (error) return showMessage(friendlyError(error));
        setGuest(false);
        location.replace(next);
    };

    $('signUpForm').onsubmit = async event => {
        event.preventDefault();
        const form = event.target;
        const displayName = form.displayName.value.trim();
        const email = form.email.value.trim();
        const password = form.password.value;
        const role = form.role.value;
        if (!displayName) return showMessage('Enter your name.');
        if (!email) return showMessage('Enter your email.');
        if (password.length < 6) return showMessage('Your password needs to be at least 6 characters.');

        busy(form, true);
        const { data: result, error } = await client.auth.signUp({
            email,
            password,
            options: {
                data: { display_name: displayName, role },
                emailRedirectTo: pageUrl('login.html?next=' + encodeURIComponent(next)),
            },
        });
        busy(form, false);
        if (error) return showMessage(friendlyError(error));

        if (result.session) {
            setGuest(false);
            location.replace(role === 'tutor' ? 'dashboard.html' : next);
        } else {
            show('signInForm');
            showMessage('Account created. We\'ve emailed ' + email + ' a confirmation link — click it, then sign in here.', 'info');
        }
    };

    $('forgotForm').onsubmit = async event => {
        event.preventDefault();
        const form = event.target;
        const email = form.email.value.trim();
        if (!email) return showMessage('Enter your email.');
        busy(form, true);
        const { error } = await client.auth.resetPasswordForEmail(email, {
            redirectTo: pageUrl('login.html?reset=1'),
        });
        busy(form, false);
        if (error) return showMessage(friendlyError(error));
        show('signInForm');
        showMessage('If there\'s an account for ' + email + ', a reset link is on its way.', 'info');
    };

    $('resetForm').onsubmit = async event => {
        event.preventDefault();
        const form = event.target;
        const password = form.password.value;
        if (password.length < 6) return showMessage('Your password needs to be at least 6 characters.');
        busy(form, true);
        const { error } = await client.auth.updateUser({ password });
        busy(form, false);
        if (error) return showMessage(friendlyError(error));
        location.replace('index.html');
    };
}

function wireGuest() {
    $('guestButton').onclick = () => {
        setGuest(true);
        location.href = next;
    };
}

init();
