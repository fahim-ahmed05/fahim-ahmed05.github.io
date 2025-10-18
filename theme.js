/* Theme switching logic (shared) */
(function () {
    const THEME_KEY = 'theme-preference'; // 'light' or 'dark'
    const el = document.documentElement;
    // The toggle button may be added to pages; query lazily
    function getToggle() {
        return document.querySelector('.theme-toggle');
    }

    function applyTheme(theme) {
        if (theme === 'light') {
            el.classList.add('theme-light');
        } else {
            el.classList.remove('theme-light');
        }
        updateButton(theme);
    }

    function updateButton(theme) {
        const btn = getToggle();
        if (!btn) return;
        const saved = localStorage.getItem(THEME_KEY);
        const icon = btn.querySelector('.icon');
        const label = btn.querySelector('.label');
        // Show 🤖 when following system (saved === 'system' or not set)
        if (!saved || saved === 'system') {
            if (icon) icon.textContent = '🤖';
            btn.setAttribute('aria-pressed', 'false');
            if (label) label.textContent = 'Device theme';
            return;
        }
        if (theme === 'light') {
            if (icon) icon.textContent = '☀️';
            btn.setAttribute('aria-pressed', 'true');
            if (label) label.textContent = 'Light theme';
        } else {
            if (icon) icon.textContent = '🌙';
            btn.setAttribute('aria-pressed', 'false');
            if (label) label.textContent = 'Dark theme';
        }
    }

    function getSystemPrefersDark() {
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    // Initialize
    let saved = localStorage.getItem(THEME_KEY); // 'light' | 'dark' | 'system' | null
    const systemDark = getSystemPrefersDark();
    const initial = !saved || saved === 'system' ? (systemDark ? 'dark' : 'light') : saved;
    applyTheme(initial);

    // React to system changes only when the user hasn't explicitly chosen
    if (window.matchMedia) {
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const listener = (e) => {
            const saved2 = localStorage.getItem(THEME_KEY);
            if (!saved2 || saved2 === 'system') {
                applyTheme(e.matches ? 'dark' : 'light');
            }
        };
        if (mq.addEventListener) mq.addEventListener('change', listener);
        else if (mq.addListener) mq.addListener(listener);
    }

    // Attach toggle listener if button exists now or later
    function attachToggle() {
        const btn = getToggle();
        if (!btn) return;
        // prevent duplicate listeners
        if (btn.__theme_attached) return;
        btn.__theme_attached = true;
        // single button click will cycle between system -> light -> dark -> system
        btn.addEventListener('click', function () {
            const savedNow = localStorage.getItem(THEME_KEY); // may be null
            let next;
            if (!savedNow || savedNow === 'system') {
                next = 'light';
            } else if (savedNow === 'light') {
                next = 'dark';
            } else if (savedNow === 'dark') {
                next = 'system';
            } else {
                next = 'system';
            }
            // Store the choice explicitly. 'system' means follow system.
            localStorage.setItem(THEME_KEY, next);
            if (next === 'system') {
                const sysDark = getSystemPrefersDark();
                applyTheme(sysDark ? 'dark' : 'light');
            } else {
                applyTheme(next);
            }
            // collapse the UI immediately after click
            try {
                const wrap = btn.closest('.theme-toggle-wrap');
                if (wrap) {
                    const COLLAPSE_MS = 300;
                    wrap.classList.add('collapsed');
                    // blur to remove focus styles
                    btn.blur();
                    setTimeout(() => requestAnimationFrame(() => wrap.classList.remove('collapsed')), COLLAPSE_MS);
                }
            } catch (e) {
                // ignore
            }
        });
    }

    // Try to attach now; if DOM not ready, attach on DOMContentLoaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', attachToggle);
    } else {
        attachToggle();
    }

    // Also observe the document for dynamically added toggles
    try {
        const obs = new MutationObserver(() => attachToggle());
        obs.observe(document.documentElement || document.body, { childList: true, subtree: true });
    } catch (e) {
        // ignore
    }
})();
