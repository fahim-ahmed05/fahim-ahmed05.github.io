/* ==========================================================================
   Link hub behaviour
   1. Theme    — system preference by default, manual override persisted
   2. Copy     — in-card copy buttons for addresses and values
   3. Sections — collapse a section, fold everything past the first rows
   4. Glass    — a specular highlight that tracks the pointer across a card
   4b. Share   — QR popup: online tab holds the URL, offline tab a text card
   5. Scrolling — in-page anchors glide; restoration stays instant
   (The load entrance is pure CSS — see the "Entrance" block in main.css.)
   No dependencies, no build step.
   ========================================================================== */
(function () {
    'use strict';

    var html = document.documentElement;
    var STORE = { theme: 'fa-theme', collapsed: 'fa-collapsed', expanded: 'fa-expanded' };
    /* The fold ends on a complete row, and main.css sets that threshold per column
       band: 4 cards up to two columns, 6 at three. The script only needs the
       smaller, so a section that folds in one band has its button wired in every
       band; the stylesheet decides when that button is actually displayed. */
    var FOLD_MIN = 4;

    function read(key, fallback) {
        try {
            var raw = localStorage.getItem(key);
            return raw === null ? fallback : JSON.parse(raw);
        } catch (e) {
            return fallback;
        }
    }

    function write(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (e) { /* private mode / storage blocked */ }
    }

    function remember(key, name, on) {
        var saved = (read(key, []) || []).slice();
        var at = saved.indexOf(name);
        if (on && at === -1) saved.push(name);
        if (!on && at > -1) saved.splice(at, 1);
        write(key, saved);
    }

    /* ----------------------------------------------------------------------
       1. Theme
       ---------------------------------------------------------------------- */
    var Theme = {
        control: document.querySelector('.theme-switch'),
        buttons: Array.prototype.slice.call(document.querySelectorAll('[data-theme-choice]'), 0),
        query: window.matchMedia('(prefers-color-scheme: dark)'),
        choice: 'auto',

        init: function () {
            if (!this.control) return;
            var self = this;

            this.buttons.forEach(function (btn) {
                btn.addEventListener('click', function () {
                    self.apply(btn.dataset.themeChoice, true);
                });
            });

            /* While the choice is "auto" the palette simply follows the OS. */
            var follow = function () { self.paint(); };
            if (this.query.addEventListener) this.query.addEventListener('change', follow);
            else if (this.query.addListener) this.query.addListener(follow);

            this.apply(read(STORE.theme, 'auto'), false);
        },

        apply: function (choice, persist) {
            if (choice !== 'light' && choice !== 'dark') choice = 'auto';
            this.choice = choice;
            if (persist) write(STORE.theme, choice);
            this.paint();
        },

        paint: function () {
            /* "auto" leaves the attribute off so prefers-color-scheme drives the
               palette; an explicit choice pins it. */
            if (this.choice === 'auto') html.removeAttribute('data-theme');
            else html.setAttribute('data-theme', this.choice);

            var index = { light: 0, dark: 1, auto: 2 }[this.choice];
            this.control.dataset.active = index;
            this.buttons.forEach(function (btn, i) {
                btn.setAttribute('aria-pressed', String(i === index));
            });
        }
    };

    /* ----------------------------------------------------------------------
       2. Copy to clipboard
       ---------------------------------------------------------------------- */
    var Toast = {
        el: document.querySelector('.toast'),
        text: document.querySelector('.toast-text'),
        timer: null,
        hider: null,

        show: function (message) {
            if (!this.el) return;
            clearTimeout(this.timer);
            clearTimeout(this.hider);
            this.text.textContent = message;
            this.el.hidden = false;
            void this.el.offsetHeight; /* let it re-enter the flow before animating */
            this.el.classList.add('is-shown');
            this.timer = setTimeout(function () {
                Toast.el.classList.remove('is-shown');
                /* Retire the announcement once the fade is over, so a stale
                   aria-live node is not re-read later. */
                Toast.hider = setTimeout(function () { Toast.el.hidden = true; }, 400);
            }, 2200);
        }
    };

    function copyText(value) {
        if (navigator.clipboard && window.isSecureContext) {
            return navigator.clipboard.writeText(value);
        }
        /* Plain http (or a locked-down browser) still needs a route. */
        return new Promise(function (resolve, reject) {
            var area = document.createElement('textarea');
            area.value = value;
            area.setAttribute('readonly', '');
            area.style.cssText = 'position:fixed;top:-1000px;opacity:0';
            document.body.appendChild(area);
            area.select();
            try {
                document.execCommand('copy') ? resolve() : reject(new Error('copy refused'));
            } catch (e) {
                reject(e);
            }
            document.body.removeChild(area);
        });
    }

    function markCopied(btn, value) {
        copyText(value).then(function () {
            Toast.show('Copied');
            if (!btn) return;
            btn.classList.add('is-copied');
            setTimeout(function () { btn.classList.remove('is-copied'); }, 1400);
        }).catch(function () {
            Toast.show('Press Ctrl + C: ' + value);
        });
    }

    var COPY_SVG = '<svg class="icon" aria-hidden="true"><use href="#i-copy"></use></svg>';

    function wireCopyTargets() {
        Array.prototype.forEach.call(document.querySelectorAll('[data-copy]'), function (node) {
            var value = node.getAttribute('data-copy');
            var name = node.getAttribute('data-copy-label');

            /* A card with nothing to open: the whole card is the trigger. */
            if (node.classList.contains('link') && !node.hasAttribute('href')) {
                node.setAttribute('role', 'button');
                node.setAttribute('tabindex', '0');
                node.title = 'Click to copy ' + (name || value);
                /* trailing glyph, so the card advertises what it actually does */
                var hint = document.createElement('span');
                hint.className = 'link-trail';
                hint.setAttribute('aria-hidden', 'true');
                hint.innerHTML = COPY_SVG;
                node.appendChild(hint);
                node.addEventListener('click', function () { markCopied(null, value); });
                node.addEventListener('keydown', function (e) {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        markCopied(null, value);
                    }
                });
                return;
            }

            /* A card that also opens something: give it a dedicated copy control so
               the link keeps working. */
            var item = node.closest('.item');
            if (!item) return;
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'copy-btn';
            btn.innerHTML = COPY_SVG;
            btn.setAttribute('aria-label', 'Copy ' + (name || value));
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                markCopied(btn, value);
            });
            item.classList.add('item--copy');
            item.appendChild(btn);
        });
    }

    /* ----------------------------------------------------------------------
       3. Sections
       ---------------------------------------------------------------------- */
    var groups = Array.prototype.slice.call(document.querySelectorAll('.group'), 0);

    function prepareGroups() {
        var savedExpanded = read(STORE.expanded, []) || [];
        var savedCollapsed = read(STORE.collapsed, []) || [];

        groups.forEach(function (group) {
            var name = group.dataset.group;
            var body = group.querySelector('.group-body');
            var list = group.querySelector('.list');
            var more = group.querySelector('[data-more]');
            var toggle = group.querySelector('.group-toggle');
            var total = list.children.length;

            /* keep the heading badge honest — the markup is the source of truth */
            var badge = group.querySelector('.group-count');
            if (badge) badge.textContent = String(total);

            if (more && total > FOLD_MIN) {
                var label = more.querySelector('.more-text');
                more.setAttribute('aria-controls', list.id);
                label.textContent = 'Show all ' + total;

                if (savedExpanded.indexOf(name) > -1) {
                    group.setAttribute('data-expanded', 'true');
                    label.textContent = 'Show less';
                }
                more.setAttribute('aria-expanded', String(group.dataset.expanded === 'true'));

                more.addEventListener('click', function () {
                    /* State flips first, always: the control reads correctly while
                       it is still moving, and a second click reverses the slide from
                       wherever it has got to rather than fighting the animation. */
                    var open = group.dataset.expanded !== 'true';
                    remember(STORE.expanded, name, open);
                    more.setAttribute('aria-expanded', String(open));
                    label.textContent = open ? 'Show less' : 'Show all ' + total;

                    if (open) {
                        /* data-opening marks a click, so the tail cascades from now
                           instead of holding its place in the load wave */
                        group.dataset.opening = 'true';
                        delete group.dataset.tailOut;
                        slideTo(list, function () { group.setAttribute('data-expanded', 'true'); });
                        window.setTimeout(function () { delete group.dataset.opening; }, 700);
                        return;
                    }

                    /* The tail has to stay laid out to fade, so the fold rule gets a
                       data-tail-out exemption and the box shrinks over the top of it.
                       Both heights are read while everything is still rendered, and
                       both attributes are set afterwards without a read in between:
                       a layout flush taken while the tail is momentarily display:none
                       leaves the browser no rendered before-state, and the fade then
                       never starts - the cards would just blink off. */
                    var from = list.offsetHeight;
                    var to = foldHeight(list);
                    group.removeAttribute('data-expanded');
                    group.dataset.tailOut = 'true';
                    slide(list, from, to, function () {
                        delete group.dataset.tailOut;
                    });
                });
            }

            if (savedCollapsed.indexOf(name) > -1) collapse(group, toggle, true);

            toggle.addEventListener('click', function () {
                var hiding = toggle.getAttribute('aria-expanded') === 'true';
                remember(STORE.collapsed, name, hiding);

                if (hiding) {
                    collapse(group, toggle, true);
                    /* data-closing keeps the body in the flow until it is shut */
                    group.dataset.closing = 'true';
                    slide(body, body.offsetHeight, 0, function () {
                        delete group.dataset.closing;
                    });
                    return;
                }

                delete group.dataset.closing;
                /* data-reveal re-times the whole section from this click */
                group.dataset.reveal = 'true';
                slideTo(body, function () { collapse(group, toggle, false); });
                window.setTimeout(function () { delete group.dataset.reveal; }, 700);
            });
        });
    }

    function collapse(group, toggle, isCollapsed) {
        group.dataset.collapsed = String(isCollapsed);
        toggle.setAttribute('aria-expanded', String(!isCollapsed));
    }

    /* Height the list has once the tail is folded away: the bottom of the last
       visible card, less the top of the list. main.css owns the threshold and
       publishes it per column band as --fold, so the script never duplicates a
       media query and never has to hide the cards to find out. */
    function foldHeight(list) {
        var kids = list.children;
        var fold = parseInt(getComputedStyle(list).getPropertyValue('--fold'), 10);
        if (!fold || kids.length <= fold) return list.offsetHeight;
        return kids[fold - 1].getBoundingClientRect().bottom - list.getBoundingClientRect().top;
    }

    /* ----------------------------------------------------------------------
       Height slides. The box that changes size is animated between two measured
       heights, so the caller only says what changed, not by how much.
       ---------------------------------------------------------------------- */
    var SLIDE_MS = 260;
    var SLIDE = 'height ' + SLIDE_MS + 'ms var(--ease)';

    function reducedMotion() {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    function canSlide() {
        return !!window.requestAnimationFrame && !reducedMotion();
    }

    function clearSlide(el) {
        el.style.transition = el.style.height = el.style.overflow = '';
    }

    /* Height only, never opacity: fading a box whose children are all
       backdrop-filter glass costs a re-blur every frame and stops the cards
       reading as glass while it moves, which is what looked like stutter. */
    function slide(el, from, to, done) {
        if (!el || !canSlide() || from === to) {
            if (done) done();
            return;
        }
        if (el._slide) window.clearTimeout(el._slide);

        el.style.overflow = 'hidden';
        el.style.height = from + 'px';
        void el.offsetHeight;                       /* commit the start frame */
        el.style.transition = SLIDE;
        el.style.height = to + 'px';

        el._slide = window.setTimeout(function () {
            el._slide = 0;
            if (done) done();                       /* land the state, then... */
            clearSlide(el);                         /* ...hand the box back to CSS */
        }, SLIDE_MS + 20);
    }

    /* Apply a change, then grow or shrink to the height the element now has. */
    function slideTo(el, mutate) {
        if (!el || !canSlide()) {
            mutate();
            return;
        }
        var before = el.offsetHeight;
        mutate();
        slide(el, before, el.offsetHeight);
    }

    /* ----------------------------------------------------------------------
       4. Glass: the specular highlight follows the pointer
       ---------------------------------------------------------------------- */
    function pct(value, total) {
        return (value / total * 100).toFixed(1) + '%';
    }

    function wireSpecular() {
        if (!window.requestAnimationFrame) return;
        if (window.matchMedia('(hover: none)').matches) return; /* no hover, no sheen */

        var queued = false;
        var point = null;

        document.addEventListener('pointermove', function (e) {
            var card = e.target.closest ? e.target.closest('.link') : null;
            if (!card) return;
            point = { card: card, x: e.clientX, y: e.clientY };
            if (queued) return;
            queued = true;

            requestAnimationFrame(function () {
                queued = false;
                if (!point) return;
                var box = point.card.getBoundingClientRect();
                point.card.style.setProperty('--mx', pct(point.x - box.left, box.width));
                point.card.style.setProperty('--my', pct(point.y - box.top, box.height));
            });
        });
    }

    /* ----------------------------------------------------------------------
       4b. Share dialog: two QR codes, one for the URL and one that carries a
       plain-text card a scanner can read with no connection at all.
       ---------------------------------------------------------------------- */
    var pageUrl = (function () {
        var canonical = document.querySelector('link[rel="canonical"]');
        return canonical ? canonical.href : location.href.split('#')[0];
    })();

    /* The offline card carries a curated set of channels rather than every
       link, so the symbol stays low-version and easy to focus a camera on.
       Keep the whole block under the 271-byte level-L budget - Signal is listed
       as a username to copy, because its 86-character share link would take the
       payload to 328 bytes on its own and past what version 10 holds. */
    var OFFLINE_TEXT = [
        'Fahim Ahmed',
        'fahim-ahmed05.github.io',
        'Email: fahim.ahmed1453@gmail.com',
        'Signal: fahim.03',
        'WhatsApp: wa.me/fahim.ahmed07',
        'Messenger: m.me/fahim.ahmed09',
        'GitHub: github.com/fahim-ahmed05',
        'LinkedIn: linkedin.com/in/fahim-ahmed05',
        'Medium: medium.com/@fahim-ahmed'
    ].join('\n');

    var QR_BOX = 340; /* every code renders into the same square, so switching
                        tabs never resizes the dialog */

    function drawQr(canvas, text) {
        if (!window.qrEncode || !canvas.getContext) return null;
        var code = window.qrEncode(text);
        /* too dense to fit: drop back to complete lines until it does */
        while (!code && text.indexOf('\n') > -1) {
            text = text.slice(0, text.lastIndexOf('\n'));
            code = window.qrEncode(text);
        }
        if (!code) return null;

        var quiet = 4;
        var span = code.size + quiet * 2;
        /* whole-pixel module size keeps the edges crisp; the leftover becomes
           symmetric padding so a version-2 and a version-10 code look alike */
        var scale = Math.max(2, Math.floor(QR_BOX / span));
        var drawn = span * scale;
        var pad = Math.floor((QR_BOX - drawn) / 2);

        canvas.width = canvas.height = QR_BOX;
        var ctx = canvas.getContext('2d');
        /* QR readers need a light plate and a dark mark, whatever the theme is */
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, QR_BOX, QR_BOX);
        ctx.fillStyle = '#0a0c12';
        for (var row = 0; row < code.size; row++) {
            for (var col = 0; col < code.size; col++) {
                if (code.modules[row][col]) {
                    ctx.fillRect(pad + (col + quiet) * scale, pad + (row + quiet) * scale, scale, scale);
                }
            }
        }
        return { text: text, version: code.version, mask: code.mask };
    }

    var Share = {
        mode: 'online',
        dialog: document.querySelector('#qr-sheet'),
        canvas: document.getElementById('qr-canvas'),
        tabs: document.querySelector('.qr-tabs'),
        save: document.querySelector('[data-share-save]'),
        current: '',

        text: function () {
            return this.mode === 'online' ? pageUrl : OFFLINE_TEXT;
        },

        render: function () {
            if (!this.dialog || !this.canvas) return;
            var drawn = drawQr(this.canvas, this.text());
            if (!drawn) {
                Toast.show('That payload is too long for one QR code');
                return;
            }
            this.current = drawn.text;
            this.save.href = this.canvas.toDataURL('image/png');
            this.save.setAttribute('download', 'fahim-ahmed-' + this.mode + '-qr.png');
        },

        setMode: function (mode) {
            this.mode = mode === 'offline' ? 'offline' : 'online';
            var self = this;
            if (this.tabs) this.tabs.dataset.active = this.mode === 'offline' ? '1' : '0';
            Array.prototype.forEach.call(document.querySelectorAll('[data-share-tab]'), function (tab) {
                tab.setAttribute('aria-pressed', String(tab.dataset.shareTab === self.mode));
            });
            this.render();
        },

        open: function () {
            if (!this.dialog) return;
            if (typeof this.dialog.showModal === 'function') this.dialog.showModal();
            else this.dialog.setAttribute('open', '');
            this.setMode(this.mode);
        },

        close: function () {
            var d = this.dialog;
            if (!d || !d.open || d.classList.contains('is-closing')) return;

            var finish = function () {
                if (!d.classList.contains('is-closing')) return;   /* once only */
                d.classList.remove('is-closing');
                if (typeof d.close === 'function') d.close();
                else d.removeAttribute('open');
            };

            if (reducedMotion()) { d.classList.add('is-closing'); finish(); return; }

            /* The UA hides the element the moment close() is called, so the
               exit animation has to play first and close() comes after. */
            d.classList.add('is-closing');
            d.addEventListener('animationend', function onEnd(e) {
                if (e.target !== d) return;
                d.removeEventListener('animationend', onEnd);
                finish();
            });
            window.setTimeout(finish, 320);                       /* safety */
        },

        init: function () {
            if (!this.dialog) return;
            var self = this;

            var trigger = document.querySelector('[data-share]');
            if (trigger) trigger.addEventListener('click', function () { self.open(); });

            Array.prototype.forEach.call(document.querySelectorAll('[data-share-tab]'), function (tab) {
                tab.addEventListener('click', function () { self.setMode(tab.dataset.shareTab); });
            });

            Array.prototype.forEach.call(document.querySelectorAll('[data-share-close]'), function (btn) {
                btn.addEventListener('click', function () { self.close(); });
            });

            /* click on the backdrop, but not on the panel itself */
            this.dialog.addEventListener('click', function (e) {
                if (e.target === self.dialog) self.close();
            });

            /* Escape fires cancel before close; stopping it lets the exit
               animation play instead of the dialog vanishing instantly */
            this.dialog.addEventListener('cancel', function (e) {
                e.preventDefault();
                self.close();
            });

            var copy = document.querySelector('[data-share-copy]');
            if (copy) {
                copy.addEventListener('click', function () {
                    /* A modal dialog paints in the top layer, above the toast,
                       so the confirmation has to live on the button itself. */
                    var glyph = copy.querySelector('use');
                    var restore = function () {
                        copy.classList.remove('is-copied');
                        copy.removeAttribute('data-copy-state');
                        if (glyph) glyph.setAttribute('href', '#i-copy');
                    };
                    copyText(self.current).then(function () {
                        copy.classList.add('is-copied');
                        copy.dataset.copyState = 'done';
                        if (glyph) glyph.setAttribute('href', '#i-check');
                        window.setTimeout(restore, 1800);
                    }, function () {
                        copy.dataset.copyState = 'fail';
                        window.setTimeout(restore, 2400);
                    });
                });
            }

            var native = document.querySelector('[data-share-native]');
            if (native && navigator.share) {
                native.hidden = false;
                native.addEventListener('click', function () {
                    navigator.share({ title: document.title, url: pageUrl })
                        .catch(function () { /* dismissed, nothing to do */ });
                });
            }
        }
    };

    /* ----------------------------------------------------------------------
       5. In-page anchors glide, explicitly
       Doing it here rather than with `scroll-behavior` on the root keeps the
       browser's reload restoration instant. The URL is deliberately left alone:
       a hash in the address bar outranks scroll restoration on the next load,
       so writing it is what made every reload jump back to the top.
       ---------------------------------------------------------------------- */
    function wireAnchors() {
        document.addEventListener('click', function (e) {
            var link = e.target.closest ? e.target.closest('a[href^="#"]') : null;
            if (!link) return;
            var id = link.getAttribute('href').slice(1);
            var target = id && document.getElementById(id);
            if (!target) return;

            e.preventDefault();
            var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
            /* move focus without a second scroll jump, and without touching the URL */
            target.setAttribute('tabindex', '-1');
            target.focus({ preventScroll: true });
        });
    }

    /* Clean up the #top that earlier builds of this page left in the address
       bar; while it is there, every reload jumps to the top by design. */
    function dropStaleHash() {
        if (location.hash === '#top' && history.replaceState) {
            history.replaceState(null, '', location.pathname + location.search);
        }
    }

    /* ----------------------------------------------------------------------
       Boot
       ---------------------------------------------------------------------- */
    Theme.init();
    prepareGroups();
    wireCopyTargets();
    wireSpecular();
    Share.init();
    wireAnchors();
    dropStaleHash();

    Array.prototype.forEach.call(document.querySelectorAll('[data-year]'), function (node) {
        node.textContent = String(new Date().getFullYear());
    });
})();
