export function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[ch]);
}

export function percent(score, total) {
    return total > 0 ? Math.round((score / total) * 100) : 0;
}

export function shortDate(iso) {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function relativeDay(iso) {
    const then = new Date(iso);
    const today = new Date();
    const startOf = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const days = Math.round((startOf(today) - startOf(then)) / 86400000);
    if (days <= 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return days + ' days ago';
    return shortDate(iso);
}

export async function loadManifest() {
    const response = await fetch('data/manifest.json');
    if (!response.ok) throw new Error('manifest');
    return response.json();
}
