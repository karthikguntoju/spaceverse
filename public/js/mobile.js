/**
 * Shared mobile behaviour. Pairs with /public/css/mobile.css.
 *
 * On phones the floating control panels of the 3D pages (solar-system
 * #ctrl, traffic-visualisation .controls-panel) cover most of the screen.
 * Here they become bottom sheets, closed by default, behind one ⚙ button.
 * Nothing runs above 768px wide.
 */
(function () {
    'use strict';
    var mq = window.matchMedia('(max-width: 768px)');
    if (!mq.matches) return;

    var PANELS = [
        { sel: '#ctrl', icon: '⚙', title: 'Controls' },
        { sel: '.controls-panel', icon: '⚙', title: 'Controls' }
    ];

    function setup() {
        PANELS.forEach(function (p) {
            var el = document.querySelector(p.sel);
            if (!el || el.__svCollapsible) return;
            el.__svCollapsible = true;
            el.classList.add('sv-collapsible');
            var btn = document.createElement('button');
            btn.className = 'sv-panel-toggle';
            btn.type = 'button';
            btn.title = p.title;
            btn.setAttribute('aria-label', p.title);
            btn.textContent = p.icon;
            btn.addEventListener('click', function () {
                var open = !el.classList.contains('sv-open');
                el.classList.toggle('sv-open', open);
                btn.classList.toggle('sv-on', open);
            });
            document.body.appendChild(btn);
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
    else setup();
})();
