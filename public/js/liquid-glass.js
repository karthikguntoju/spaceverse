/* ═══════════════════════════════════════════════════════════════════════
   SPACEVERSE — LIQUID GLASS RUNTIME
   ═══════════════════════════════════════════════════════════════════════
   Everything the glass needs to feel physical rather than painted:
   pointer-tracked speculars, a parallax aurora behind the blur, ripples,
   sliding tab lozenges, the dock's scroll state, and reveal-on-scroll.

   Self-mounting: include the script and it wires whatever markup it finds.
   Nothing here is required for the page to function — if it fails, the
   page is still a working page, just a stiller one.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var coarse = window.matchMedia('(pointer: coarse)').matches;

    /* Every class the site uses for a pressable control. The system pages know
       exactly one of these (`.btn`); the retrofitted pages between them use the
       other thirty, which is why their buttons all looked slightly different
       from each other. Kept here rather than duplicated as a selector chain in
       both stylesheets — the runtime tags the matches and the CSS styles one
       class. Add a new button class here and it inherits the whole treatment. */
    var CONTROLS = [
        '.btn', '.btn-primary', '.btn-secondary', '.btn-feature', '.btn-out',
        '.btn-gold', '.btn-back-small', '.submit-btn', '.top-btn',
        '.filter-btn', '.tab-btn', '.view-btn', '.traffic-btn', '.nav-btn',
        '.pill-btn', '.watch-btn', '.back-btn', '.back-home-btn',
        '.nav-back-btn', '.logout-btn', '.link-btn', '.google-btn',
        '.like-btn', '.comments-btn', '.pb-item', '.chip', '.a-btn', '.a-chip',
        'button[type="submit"]'
        /* Deliberately absent: `.btn-icon` (a <div> holding the emoji inside a
           quiz card), `.view-toggle` and `.ctrl-toggle` (the wrappers around
           the real controls), `.play-button` (a decorative triangle over a
           video thumbnail). None of them are pressable, and the PRESSABLE
           guard below would reject them anyway — listing them here only
           implies they are controls. */
    ].join(',');

    /* A sweep advertises "this is pressable", so it must not land on the
       read-only pills that share the class vocabulary (.pilot-chip, stat
       chips). Semantics, not `cursor: pointer`, decide: the cursor is one of
       the things being corrected. */
    var PRESSABLE = 'a[href],button,input[type="submit"],input[type="button"],' +
        '[role="button"],[onclick],[data-lg-open],[data-lg-logout]';

    /* ── Aurora field ─────────────────────────────────────────────────
       Injected rather than hand-written into every page: the glass is
       meaningless without something coloured behind it, so this is not
       optional furniture. */
    function mountAurora() {
        if (document.querySelector('.lg-aurora')) return;
        var field = document.createElement('div');
        field.className = 'lg-aurora';
        field.setAttribute('aria-hidden', 'true');
        field.innerHTML =
            '<div class="lg-orb o1"></div>' +
            '<div class="lg-orb o2"></div>' +
            '<div class="lg-orb o3"></div>' +
            '<div class="lg-orb o4"></div>';
        var grid = document.createElement('div');
        grid.className = 'lg-grid';
        grid.setAttribute('aria-hidden', 'true');
        document.body.insertBefore(grid, document.body.firstChild);
        document.body.insertBefore(field, document.body.firstChild);
    }

    /* Orbs drift against the scroll, so the backdrop behind a fixed panel
       keeps changing and the blur stays visibly alive. */
    function auroraParallax() {
        if (reduced) return;
        var orbs = document.querySelectorAll('.lg-orb');
        if (!orbs.length) return;
        var depth = [0.06, -0.05, 0.035, -0.028];
        var ticking = false;

        function apply() {
            var y = window.scrollY || 0;
            for (var i = 0; i < orbs.length; i++) {
                orbs[i].style.setProperty('--oy', (y * depth[i % depth.length]).toFixed(1) + 'px');
            }
            ticking = false;
        }
        window.addEventListener('scroll', function () {
            if (!ticking) { ticking = true; requestAnimationFrame(apply); }
        }, { passive: true });
        apply();
    }

    /* ── Specular tracking ────────────────────────────────────────────
       Writes the pointer position into --mx/--my on the hovered surface.
       The CSS turns that into a bloom, so light appears to gather where
       the finger is. Skipped on touch: there is no hover to track and the
       per-move writes are not worth the battery. */
    function specular() {
        if (coarse || reduced) return;
        var sel = '.glass, .btn, .lg-modal-panel, [data-lg-spec]';

        document.addEventListener('pointermove', function (e) {
            var el = e.target.closest ? e.target.closest(sel) : null;
            if (!el) return;
            var r = el.getBoundingClientRect();
            el.style.setProperty('--mx', (((e.clientX - r.left) / r.width) * 100).toFixed(2) + '%');
            el.style.setProperty('--my', (((e.clientY - r.top) / r.height) * 100).toFixed(2) + '%');
        }, { passive: true });

        // Park the highlight off-surface on exit so cards go cold again.
        document.addEventListener('pointerout', function (e) {
            var el = e.target.closest ? e.target.closest(sel) : null;
            if (!el || (e.relatedTarget && el.contains(e.relatedTarget))) return;
            el.style.setProperty('--mx', '50%');
            el.style.setProperty('--my', '-40%');
        }, { passive: true });
    }

    /* ── Activate ─────────────────────────────────────────────────────
       Roughly fifty-five things on this site are clickable <div>s: the quiz's
       nine planet cards, twelve mission cards, fifteen event cards, twelve
       video thumbnails, the five review stars, both Google sign-in rows. They
       are wired with delegated click handlers, so they work with a mouse and
       are completely unreachable with a keyboard — no tab stop, no focus, no
       Enter. On /quiz that means the only way to pick a planet is to point at
       it.

       `cursor: pointer` is the page authoring its own intent: it means "this
       is pressable". So anything carrying it that is not already a control
       gets promoted to one. Doing it here rather than editing six files keeps
       the guarantee in one place, and because the promoted element then
       matches PRESSABLE it also picks up the sheen, the focus ring and the
       right radius on the next pass. */
    function activate() {
        var SKIP = 'a[href],button,input,select,textarea,label,' +
            '[role="button"],[role="link"],[role="tab"],[tabindex]';

        function promote(el) {
            if (el.matches(SKIP) || el.closest(SKIP)) return;
            if (getComputedStyle(el).cursor !== 'pointer') return;
            /* A parent with the same cursor means this is a child inheriting
               it, not the target. Only the outermost element is the control. */
            if (el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer') return;
            /* Wrapping a real control means this is a container; promoting it
               would add a dead tab stop in front of the actual button. */
            if (el.querySelector('a[href],button,input,select,textarea')) return;
            var r = el.getBoundingClientRect();
            if (r.width < 24 || r.height < 14) return;
            /* A pointer cursor on a whole region is a styling accident, not a
               button. Anything that big is not what this is for. */
            if (r.width * r.height > window.innerWidth * window.innerHeight * 0.4) return;

            el.setAttribute('role', 'button');
            el.setAttribute('tabindex', '0');
        }

        function sweep() {
            Array.prototype.forEach.call(
                document.querySelectorAll('div,span,li,td,tr'), promote);
        }
        sweep();

        /* Enter and Space are what a button responds to. Space would otherwise
           scroll the page out from under the press. */
        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
            var el = e.target;
            if (!el || !el.getAttribute || el.getAttribute('role') !== 'button') return;
            if (el.matches('a[href],button,input,select,textarea')) return;
            e.preventDefault();
            el.click();
        });

        return sweep;
    }

    /* ── Controls ─────────────────────────────────────────────────────
       Tags every pressable control with what the stylesheets need to know
       about it. Two things, both of which CSS cannot work out on its own.

       1. `lg-sheen` — the travelling highlight. Only `.btn` ever carried it,
          so on sixteen of eighteen routes the buttons sat inert while the two
          system pages swept. `::before { inset: -1px }` needs a positioned
          host or it anchors to the nearest positioned ancestor and paints a
          page-sized gradient; several of these controls are absolutely
          positioned overlays that must not be forced to `relative` (it drops
          them into normal flow and they stretch full width), so only the
          statically positioned ones get `lg-sheen--rel`.

       2. `lg-surface` — a shape correction. The bridge sets
          `border-radius: 999px` on everything it treats as a button, which is
          right for a pill and wrong the moment a control is tall: the quiz's
          252x122 planet buttons came out as lozenges, and Artemis's 1054x69
          resource links as capsules. Past roughly 64px tall a control has
          stopped being a pill and become a surface, so it takes the panel
          radius instead. Height is the only way to tell, and only the DOM
          knows it. */
    function controls(reactivate) {
        var SURFACE_H = 64;

        function tag(el) {
            if (!el.matches(PRESSABLE)) return;
            if (!el.classList.contains('lg-sheen')) {
                if (!reduced) {
                    el.classList.add('lg-sheen');
                    if (getComputedStyle(el).position === 'static') {
                        el.classList.add('lg-sheen--rel');
                    }
                }
            }
            /* Re-checked on every pass, not just the first: a button that fits
               on one line at desktop width wraps to two on a phone and crosses
               the threshold. */
            el.classList.toggle('lg-surface',
                el.getBoundingClientRect().height > SURFACE_H);
        }

        /* Idempotent, so re-running over the whole body is cheap and one pass
           covers nodes added anywhere. Promotion runs first: a card that just
           became `role="button"` is a control from this pass on, so it picks up
           the sheen and the right radius without a second mechanism. */
        function sweep() {
            if (reactivate) reactivate();
            Array.prototype.forEach.call(document.querySelectorAll(CONTROLS), tag);
        }
        sweep();

        /* Half these pages build their action rows from fetched data, so the
           controls do not exist at boot. Coalesced to one pass per frame, and
           only when elements were actually added. */
        var queued = false;
        function schedule() {
            if (queued) return;
            queued = true;
            requestAnimationFrame(function () { queued = false; sweep(); });
        }
        new MutationObserver(function (recs) {
            for (var i = 0; i < recs.length; i++) {
                for (var j = 0; j < recs[i].addedNodes.length; j++) {
                    if (recs[i].addedNodes[j].nodeType === 1) { schedule(); return; }
                }
            }
        }).observe(document.body, { childList: true, subtree: true });

        window.addEventListener('resize', schedule, { passive: true });
    }

    /* ── Tilt ─────────────────────────────────────────────────────────
       A couple of degrees only. Glass that swings like a hinge reads as
       cheap; glass that barely acknowledges the pointer reads as heavy. */
    function tilt() {
        if (coarse || reduced) return;
        var cards = document.querySelectorAll('[data-lg-tilt]');
        Array.prototype.forEach.call(cards, function (card) {
            card.addEventListener('pointermove', function (e) {
                var r = card.getBoundingClientRect();
                var px = (e.clientX - r.left) / r.width - 0.5;
                var py = (e.clientY - r.top) / r.height - 0.5;
                card.style.transform =
                    'perspective(900px) rotateX(' + (-py * 5).toFixed(2) + 'deg) rotateY(' +
                    (px * 5).toFixed(2) + 'deg) translateY(-4px)';
            });
            card.addEventListener('pointerleave', function () {
                card.style.transform = '';
            });
        });
    }

    /* ── Ripple ───────────────────────────────────────────────────────
       Light spreading from the contact point. */
    function ripple() {
        if (reduced) return;
        document.addEventListener('pointerdown', function (e) {
            var btn = e.target.closest ? e.target.closest('.btn, .glass--tap') : null;
            if (!btn) return;
            var r = btn.getBoundingClientRect();
            var size = Math.max(r.width, r.height) * 1.1;
            var dot = document.createElement('span');
            dot.className = 'lg-ripple';
            dot.style.width = dot.style.height = size + 'px';
            dot.style.left = (e.clientX - r.left) + 'px';
            dot.style.top = (e.clientY - r.top) + 'px';
            btn.appendChild(dot);
            setTimeout(function () { dot.remove(); }, 640);
        }, { passive: true });
    }

    /* ── Dock ─────────────────────────────────────────────────────────
       Condenses once the page has scrolled, and gains an opaque backing so
       the links stay readable over bright content. */
    function dock() {
        var bar = document.querySelector('.dock');
        if (!bar) return;
        var ticking = false;

        function onScroll() {
            bar.classList.toggle('is-stuck', (window.scrollY || 0) > 24);
            ticking = false;
        }
        window.addEventListener('scroll', function () {
            if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
        }, { passive: true });
        onScroll();

        var burger = document.querySelector('.dock-burger');
        var sheet = document.querySelector('.dock-sheet');
        if (burger && sheet) {
            burger.addEventListener('click', function () {
                var open = sheet.classList.toggle('is-open');
                burger.classList.toggle('is-open', open);
                burger.setAttribute('aria-expanded', String(open));
            });
            sheet.addEventListener('click', function (e) {
                if (e.target.closest('a')) {
                    sheet.classList.remove('is-open');
                    burger.classList.remove('is-open');
                }
            });
            document.addEventListener('click', function (e) {
                if (!sheet.contains(e.target) && !burger.contains(e.target)) {
                    sheet.classList.remove('is-open');
                    burger.classList.remove('is-open');
                    burger.setAttribute('aria-expanded', 'false');
                }
            });
        }

        // Mark the section currently under the dock.
        var links = bar.querySelectorAll('.dock-nav a[href^="#"]');
        if (!links.length || !('IntersectionObserver' in window)) return;
        var map = {};
        Array.prototype.forEach.call(links, function (a) {
            var el = document.querySelector(a.getAttribute('href'));
            if (el) map[el.id] = a;
        });
        /* Track the whole visible set and light exactly one link. Reacting to
           entries one at a time lets two sections both end up marked when
           they cross the band in the same callback. */
        var visible = {};
        var spy = new IntersectionObserver(function (entries) {
            entries.forEach(function (en) {
                if (en.isIntersecting) visible[en.target.id] = en.boundingClientRect.top;
                else delete visible[en.target.id];
            });
            var ids = Object.keys(visible);
            Array.prototype.forEach.call(links, function (a) { a.classList.remove('is-active'); });
            if (!ids.length) return;
            // Topmost section wins when several straddle the band.
            ids.sort(function (a, b) { return visible[a] - visible[b]; });
            if (map[ids[0]]) map[ids[0]].classList.add('is-active');
        }, { rootMargin: '-45% 0px -50% 0px' });
        Object.keys(map).forEach(function (id) { spy.observe(document.getElementById(id)); });
    }

    /* ── Tabs ─────────────────────────────────────────────────────────
       The lozenge is a real element that slides, not a border that jumps. */
    function tabs() {
        var groups = document.querySelectorAll('.tabs');
        Array.prototype.forEach.call(groups, function (group) {
            var buttons = group.querySelectorAll('.tab');
            if (!buttons.length) return;
            var pill = group.querySelector('.tabs-pill');
            if (!pill) {
                pill = document.createElement('span');
                pill.className = 'tabs-pill';
                group.insertBefore(pill, group.firstChild);
            }

            function move(btn) {
                pill.style.width = btn.offsetWidth + 'px';
                pill.style.transform = 'translateX(' + (btn.offsetLeft - group.clientLeft) + 'px)';
            }

            function select(btn) {
                Array.prototype.forEach.call(buttons, function (b) {
                    var on = b === btn;
                    b.setAttribute('aria-selected', String(on));
                    b.classList.toggle('is-active', on);
                    var panelId = b.getAttribute('aria-controls');
                    if (panelId) {
                        var panel = document.getElementById(panelId);
                        if (panel) panel.hidden = !on;
                    }
                });
                move(btn);
            }

            Array.prototype.forEach.call(buttons, function (b) {
                b.addEventListener('click', function () { select(b); });
            });

            var initial = group.querySelector('.tab[aria-selected="true"]') || buttons[0];
            // Wait a frame: offsetWidth is 0 until the group has been laid out.
            requestAnimationFrame(function () { select(initial); });
            window.addEventListener('resize', function () {
                var on = group.querySelector('.tab[aria-selected="true"]') || buttons[0];
                move(on);
            });
            group.__lgSelect = select;
        });
    }

    /* ── Reveal ───────────────────────────────────────────────────────── */
    function reveal() {
        var items = document.querySelectorAll('.reveal, .reveal-group');
        if (!items.length) return;
        if (reduced || !('IntersectionObserver' in window)) {
            Array.prototype.forEach.call(items, function (el) { el.classList.add('is-in'); });
            return;
        }
        // Index the children so the CSS can stagger them.
        Array.prototype.forEach.call(document.querySelectorAll('.reveal-group'), function (g) {
            Array.prototype.forEach.call(g.children, function (child, i) {
                child.style.setProperty('--i', i);
            });
        });
        var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (en) {
                if (!en.isIntersecting) return;
                en.target.classList.add('is-in');
                io.unobserve(en.target);
            });
        }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
        Array.prototype.forEach.call(items, function (el) { io.observe(el); });
    }

    /* ── Smooth in-page jumps ────────────────────────────────────────
       Routed through Lenis when a page runs it, otherwise native. Letting
       both drive at once makes them fight and the scroll stutters. */
    function anchors() {
        document.addEventListener('click', function (e) {
            var a = e.target.closest ? e.target.closest('a[href^="#"]') : null;
            if (!a) return;
            var id = a.getAttribute('href');
            if (!id || id === '#') return;
            var target = document.querySelector(id);
            if (!target) return;
            e.preventDefault();
            var to = target.getBoundingClientRect().top + (window.scrollY || 0) - 78;
            if (window.lenis && typeof window.lenis.scrollTo === 'function') {
                window.lenis.scrollTo(to, { duration: 1.2 });
            } else {
                window.scrollTo({ top: to, behavior: reduced ? 'auto' : 'smooth' });
            }
        });
    }

    /* ── Modals ──────────────────────────────────────────────────────── */
    function modals() {
        function close(m) {
            m.classList.remove('is-open');
            document.body.classList.remove('is-locked');
        }
        document.addEventListener('click', function (e) {
            var opener = e.target.closest ? e.target.closest('[data-lg-open]') : null;
            if (opener) {
                var m = document.getElementById(opener.getAttribute('data-lg-open'));
                if (m) {
                    m.classList.add('is-open');
                    document.body.classList.add('is-locked');
                    var first = m.querySelector('input, button, select, textarea');
                    if (first) setTimeout(function () { first.focus(); }, 260);
                }
                return;
            }
            var closer = e.target.closest ? e.target.closest('[data-lg-close]') : null;
            if (closer) {
                var owner = closer.closest('.lg-modal');
                if (owner) close(owner);
                return;
            }
            // Click on the scrim itself, not on the panel.
            if (e.target.classList && e.target.classList.contains('lg-modal')) close(e.target);
        });
        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape') return;
            var open = document.querySelector('.lg-modal.is-open');
            if (open) close(open);
        });
    }

    /* ── Session helpers ─────────────────────────────────────────────
       Shared so every page renders the pilot chip identically instead of
       each one inventing its own header state. */
    var LG = window.LiquidGlass = window.LiquidGlass || {};

    LG.session = function () {
        return fetch('/api/user', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .catch(function () { return { loggedIn: false }; });
    };

    LG.logout = function () {
        // Drain the body before navigating: an unread response stream gets
        // torn down by the redirect and logs net::ERR_ABORTED.
        return fetch('/api/logout', { method: 'POST', credentials: 'same-origin' })
            .then(function (r) { return r.text().catch(function () { }); })
            .catch(function () { })
            .then(function () { window.location.href = '/'; });
    };

    LG.paintPilot = function (user) {
        var chips = document.querySelectorAll('[data-pilot-chip]');
        if (!chips.length) return;
        var name = (user && user.username) || 'Explorer';
        Array.prototype.forEach.call(chips, function (chip) {
            var nameEl = chip.querySelector('.pilot-name');
            var avatar = chip.querySelector('.pilot-avatar');
            if (nameEl) nameEl.textContent = name;
            if (avatar) avatar.textContent = name.trim().charAt(0).toUpperCase() || 'E';
            chip.hidden = !(user && user.loggedIn);
        });
        Array.prototype.forEach.call(document.querySelectorAll('[data-signed-out]'), function (el) {
            el.hidden = !!(user && user.loggedIn);
        });
        Array.prototype.forEach.call(document.querySelectorAll('[data-signed-in]'), function (el) {
            el.hidden = !(user && user.loggedIn);
        });
    };

    /* Any page can opt into the shared header wiring with data-lg-auth. */
    function autoSession() {
        if (!document.querySelector('[data-pilot-chip], [data-signed-in], [data-signed-out]')) return;
        LG.session().then(LG.paintPilot);
        document.addEventListener('click', function (e) {
            if (e.target.closest && e.target.closest('[data-lg-logout]')) {
                e.preventDefault();
                LG.logout();
            }
        });
    }

    /* ── Boot ─────────────────────────────────────────────────────────── */
    function boot() {
        /* Two modes. Pages built on the system (`data-lg`) get the full base
           layer — typography, resets, scrollbars. Legacy pages retrofitted
           through the theme bridge get `lg-lite`: the material, the aurora
           and the behaviours, but none of the resets that would tear up
           layouts written against their own stylesheet. */
        document.body.classList.add(document.body.hasAttribute('data-lg') ? 'lg' : 'lg-lite');
        mountAurora();
        auroraParallax();
        specular();
        controls(activate());
        tilt();
        ripple();
        dock();
        tabs();
        reveal();
        anchors();
        modals();
        autoSession();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
