/**
 * Launch Checklist — the existing quiz, with a clock and three lives.
 *
 * THIS MISSION IS THE MEASUREMENT.
 *
 * The whole argument for building a mission core first was that the third
 * mission would be cheap. This is the third mission, and it is deliberately the
 * least like the other two: no 3D scene, no renderer, no WebXR, pure DOM. If the
 * core needed changing to accommodate it, the core is wrong and that is the
 * finding. Record what it actually cost.
 *
 * Right answer clears a checklist item. Wrong answer calls a hold. Three holds
 * and the launch is scrubbed. Per-question clock, because a quiz you can sit on
 * forever is a form, not a game.
 */

const LIVES = 3;
const PER_QUESTION_MS = 15000;

export function createQuizRun(deps = {}) {
    const {
        questions = [],   // [{ question, options, correctAnswer }]
        hud = {},         // { showQuestion, setLives, setClock, flash }
        audio = {}        // { blip }
    } = deps;

    let order = [];
    let index = 0;
    let correct = 0;
    let wrong = 0;
    let lives = LIVES;
    let questionMsLeft = PER_QUESTION_MS;
    let outcome = null;   // null | 'won' | 'lost'

    function current() {
        return order[index] || null;
    }

    function present() {
        const q = current();
        if (!q) return;
        questionMsLeft = PER_QUESTION_MS;
        if (hud.showQuestion) hud.showQuestion(q, index, order.length);
        if (hud.setLives) hud.setLives(lives);
    }

    /**
     * Call a hold.
     *
     * A wrong answer keeps you on the same checklist item — that is what a hold
     * is, you fix the item and re-run it. Advancing on a wrong answer meant
     * getting the FINAL item wrong still cleared the checklist and won the run,
     * which made the last question free.
     *
     * A timeout does advance, because the item defeated you and looping on it
     * forever is not a game.
     */
    function loseALife(reason) {
        wrong++;
        lives--;
        if (audio.blip) audio.blip(200);
        if (hud.flash) hud.flash('hold', reason);
        if (hud.setLives) hud.setLives(lives);
        if (lives <= 0) {
            outcome = 'lost';
            return;
        }
        if (reason === 'timeout') advance();
        else questionMsLeft = PER_QUESTION_MS;   // re-run the same item
    }

    function advance() {
        index++;
        if (index >= order.length) outcome = 'won';
        else present();
    }

    return {
        meta: {
            id: 'quiz-run',
            title: 'Launch Checklist',
            brief: 'Clear the checklist before launch. Three holds and the launch is scrubbed.',
            // No maxMs: the pressure here is per-question, not overall, and the
            // core only enforces a whole-run cap. Lives end the run instead.
            maxMs: 0
        },

        init() {
            if (!questions.length) throw new Error('[quiz-run] no questions supplied');
            order = questions.slice().sort(() => Math.random() - 0.5);
            index = 0;
            correct = 0;
            wrong = 0;
            lives = LIVES;
            outcome = null;
        },

        start() {
            present();
        },

        update(dt) {
            if (outcome) return outcome === 'won' ? { won: true } : { failed: true, reason: 'scrubbed' };

            questionMsLeft -= dt * 1000;
            if (hud.setClock) hud.setClock(Math.max(0, questionMsLeft), PER_QUESTION_MS);

            if (questionMsLeft <= 0) {
                loseALife('timeout');
                if (outcome === 'lost') return { failed: true, reason: 'scrubbed' };
            }
            return null;
        },

        /** Called by the page when the player picks an option. */
        answer(optionIndex) {
            const q = current();
            if (!q || outcome) return null;

            if (optionIndex === q.correctAnswer) {
                correct++;
                if (audio.blip) audio.blip(880);
                if (hud.flash) hud.flash('clear');
                advance();
                return true;
            }
            loseALife('wrong');
            return false;
        },

        onInput(event) {
            if (event && event.type === 'answer') this.answer(event.index);
        },

        end() {
            return {
                correct,
                wrong,
                livesLeft: Math.max(0, lives),
                total: order.length
            };
        },

        teardown() {
            if (hud.showQuestion) hud.showQuestion(null);
        },

        _state: () => ({ index, correct, wrong, lives, outcome, questionMsLeft, total: order.length })
    };
}

export default createQuizRun;
