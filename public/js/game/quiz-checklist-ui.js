/**
 * Launch Checklist — the page wiring for the quiz-run mission.
 *
 * Deliberately does NOT reuse the existing quiz flow's DOM. That flow has prev
 * and next navigation and lets you sit on a question forever, which is the exact
 * opposite of what this mission is. Rewiring it would risk a feature that works
 * today; an overlay costs a few lines of CSS and touches nothing.
 *
 * This file owns the frame loop, because the core does not own one. On a page
 * with no renderer that means a plain requestAnimationFrame, which is correct
 * here precisely because there is no WebXR session to worry about.
 */
import MissionCore from './core.js';
import { createQuizRun } from './missions/quiz-run.js';

const CSS = `
#checklist-overlay {
    position: fixed; inset: 0; z-index: 9000; display: none;
    align-items: center; justify-content: center; padding: 20px;
    background: radial-gradient(circle at 50% 40%, rgba(9,20,40,0.86), rgba(3,5,12,0.97));
    backdrop-filter: blur(6px); font-family: 'Inter', system-ui, sans-serif;
}
#checklist-overlay.show { display: flex; }
.cl-panel {
    width: min(720px, 100%); border-radius: 20px; padding: 26px;
    background: linear-gradient(160deg, rgba(18,30,55,0.94), rgba(8,13,24,0.94));
    border: 1px solid rgba(122,162,255,0.28); color: #e8eefc;
}
.cl-top { display: flex; justify-content: space-between; align-items: center; gap: 14px; margin-bottom: 6px; }
.cl-tag { font-size: 11px; letter-spacing: 2px; font-weight: 700; color: #7aa2ff; }
.cl-lives { font-size: 20px; letter-spacing: 4px; }
.cl-clock { height: 5px; border-radius: 99px; background: rgba(255,255,255,0.1); overflow: hidden; margin: 14px 0 18px; }
.cl-clock i { display: block; height: 100%; width: 100%; background: linear-gradient(90deg,#64ffda,#7aa2ff); transition: width 0.1s linear; }
.cl-q { font-size: clamp(17px, 2.6vw, 22px); line-height: 1.45; margin: 0 0 18px; }
.cl-opts { display: grid; gap: 10px; }
.cl-opt {
    text-align: left; padding: 13px 16px; border-radius: 12px; cursor: pointer;
    background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12);
    color: #e8eefc; font: inherit; font-size: 15px; transition: background 0.15s, border-color 0.15s;
}
.cl-opt:hover { background: rgba(122,162,255,0.16); border-color: rgba(122,162,255,0.5); }
.cl-flash { margin-top: 14px; min-height: 22px; font-size: 14px; font-weight: 600; }
.cl-flash.clear { color: #64ffda; }
.cl-flash.hold { color: #ff8b8b; }
.cl-done { text-align: center; }
.cl-done h2 { font-family: 'Orbitron', sans-serif; letter-spacing: 3px; margin: 0 0 10px; }
.cl-done .cl-score { font-size: 34px; font-weight: 800; margin: 8px 0; }
.cl-note { font-size: 12.5px; color: #ffb46b; margin-top: 10px; }
.cl-actions { display: flex; gap: 10px; justify-content: center; margin-top: 18px; flex-wrap: wrap; }
.cl-btn {
    padding: 10px 18px; border-radius: 999px; cursor: pointer; font: inherit; font-size: 14px;
    background: rgba(100,255,218,0.14); border: 1px solid rgba(100,255,218,0.4); color: #64ffda;
}
.cl-btn.ghost { background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.18); color: #e8eefc; }
`;

let mounted = false;
let rafId = null;
let lastT = 0;
let el = {};

function mount() {
    if (mounted) return;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const overlay = document.createElement('div');
    overlay.id = 'checklist-overlay';
    overlay.innerHTML = `
        <div class="cl-panel">
            <div class="cl-body">
                <div class="cl-top">
                    <span class="cl-tag">LAUNCH CHECKLIST</span>
                    <span class="cl-lives" id="cl-lives">🟢🟢🟢</span>
                </div>
                <div class="cl-clock"><i id="cl-clock"></i></div>
                <p class="cl-q" id="cl-question">…</p>
                <div class="cl-opts" id="cl-options"></div>
                <div class="cl-flash" id="cl-flash"></div>
                <div class="cl-actions">
                    <button class="cl-btn ghost" id="cl-quit">Abandon run</button>
                </div>
            </div>
            <div class="cl-done" id="cl-done" style="display:none">
                <h2 id="cl-headline">MISSION COMPLETE</h2>
                <div id="cl-detail"></div>
                <div class="cl-score" id="cl-score"></div>
                <div class="cl-note" id="cl-note" style="display:none"></div>
                <div class="cl-actions">
                    <button class="cl-btn" id="cl-again">Run it again</button>
                    <button class="cl-btn ghost" id="cl-close">Back to quiz</button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(overlay);

    el = {
        overlay,
        body: overlay.querySelector('.cl-body'),
        done: overlay.querySelector('#cl-done'),
        lives: overlay.querySelector('#cl-lives'),
        clock: overlay.querySelector('#cl-clock'),
        question: overlay.querySelector('#cl-question'),
        options: overlay.querySelector('#cl-options'),
        flash: overlay.querySelector('#cl-flash'),
        headline: overlay.querySelector('#cl-headline'),
        detail: overlay.querySelector('#cl-detail'),
        score: overlay.querySelector('#cl-score'),
        note: overlay.querySelector('#cl-note')
    };

    overlay.querySelector('#cl-quit').onclick = () => {
        if (window.confirm('Abandon this run? It will not be scored.')) stop(true);
    };
    overlay.querySelector('#cl-close').onclick = () => close();
    overlay.querySelector('#cl-again').onclick = () => {
        close();
        start(window.__checklistQuestions || []);
    };

    MissionCore.on('result', onResult);
    mounted = true;
}

const hud = {
    showQuestion(q) {
        if (!q) return;
        el.question.textContent = q.question;
        el.options.innerHTML = '';
        q.options.forEach((text, i) => {
            const b = document.createElement('button');
            b.className = 'cl-opt';
            b.textContent = text;
            b.onclick = () => MissionCore.input({ type: 'answer', index: i });
            el.options.appendChild(b);
        });
        el.flash.textContent = '';
        el.flash.className = 'cl-flash';
    },
    setLives(n) {
        el.lives.textContent = '🟢'.repeat(Math.max(0, n)) + '🔴'.repeat(Math.max(0, 3 - n));
    },
    setClock(msLeft, msTotal) {
        el.clock.style.width = `${Math.max(0, (msLeft / msTotal) * 100)}%`;
    },
    flash(kind, reason) {
        el.flash.className = `cl-flash ${kind}`;
        el.flash.textContent = kind === 'clear'
            ? '✔ Item cleared'
            : (reason === 'timeout' ? '⏱ HOLD — out of time on that item' : '✖ HOLD — re-run that item');
    }
};

function loop(t) {
    const dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 0;
    lastT = t;
    MissionCore.tick(dt);
    rafId = requestAnimationFrame(loop);
}

function stopLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    lastT = 0;
}

function onResult(result) {
    stopLoop();
    if (result.abandoned) return;

    el.body.style.display = 'none';
    el.done.style.display = '';
    el.headline.textContent = result.won ? '🚀 LAUNCH CLEARED' : '🛑 LAUNCH SCRUBBED';
    el.detail.textContent =
        `${result.facts.correct} of ${result.facts.total} items cleared · ` +
        `${result.facts.wrong} hold${result.facts.wrong === 1 ? '' : 's'}`;
    el.score.textContent = typeof result.score === 'number' ? `${result.score} XP` : '';

    // Never claim a save that did not happen.
    if (result.saved === false) {
        el.note.style.display = '';
        el.note.textContent = '⚠ Not saved — no connection. It will retry automatically.';
    } else {
        el.note.style.display = 'none';
    }
}

function close() {
    el.overlay.classList.remove('show');
    el.body.style.display = '';
    el.done.style.display = 'none';
    MissionCore.reset();
}

function stop(abandon) {
    stopLoop();
    if (abandon) MissionCore.abort('player-left');
    close();
}

/** Start a checklist run over the questions the quiz page already loaded. */
export function start(questions) {
    if (!questions || !questions.length) {
        window.alert('Pick a planet first — the checklist runs on that quiz.');
        return;
    }
    mount();
    window.__checklistQuestions = questions;

    // Registration is one-shot per id, so a re-run replaces the instance.
    MissionCore.unregister('quiz-run');
    MissionCore.register(createQuizRun({ questions, hud }));

    el.overlay.classList.add('show');
    el.body.style.display = '';
    el.done.style.display = 'none';

    MissionCore.run('quiz-run').then(() => {
        stopLoop();
        rafId = requestAnimationFrame(loop);
    }).catch((err) => {
        console.error('[checklist] could not start:', err);
        window.alert('Could not start the checklist: ' + err.message);
        close();
    });
}

// The quiz page is a classic script, so hand it a global entry point.
window.SpaceverseChecklist = { start };
export default { start };
