/**
 * Offline assistant corpus (services/space-knowledge.js).
 *
 * The chatbot falls back to this module whenever Gemini is unavailable, which is
 * the default state (no valid GEMINI_API_KEY). These tests pin that the fallback
 * actually answers the topics this platform teaches — the strict review flagged
 * that the old keyword fallback could not answer "Kessler syndrome", the app's
 * own core subject — and that it degrades gracefully on nonsense input.
 */
const { findAnswer, answerSpaceQuestion, _entryCount } = require('../services/space-knowledge');

describe('space knowledge corpus', () => {
    it('has a substantial number of curated entries', () => {
        expect(_entryCount).toBeGreaterThanOrEqual(40);
    });

    it('answers the Kessler syndrome question with real content', () => {
        const a = findAnswer('What is the Kessler syndrome?');
        expect(a).toBeTruthy();
        expect(a.toLowerCase()).toContain('kessler');
        expect(a.toLowerCase()).toMatch(/cascade|chain reaction|runaway/);
    });

    it.each([
        ['how do rockets work in space?', /newton|reaction|exhaust/i],
        ['difference between LEO and GEO', /geostationary|35,?786|low earth orbit/i],
        ['tell me about the planet mars', /mars|red|olympus mons/i],
        ['what is a black hole', /event horizon|escape velocity|light/i],
        ['what causes the seasons', /tilt|axial|23\.5/i],
        ['how big is the universe', /93 billion|observable/i],
        ['what is delta-v', /velocity|rocket equation|propellant/i],
        ['what is space debris', /debris|junk|fragment/i],
    ])('answers %j', (q, pattern) => {
        const a = findAnswer(q);
        expect(a).toBeTruthy();
        expect(a).toMatch(pattern);
    });

    it('greets without matching "hi" inside ordinary words', () => {
        // "which" / "this" contain "hi" — the old fallback fired the greeting on them.
        const a = findAnswer('which is the closest planet to the sun') || '';
        expect(a.startsWith('Hi —')).toBe(false);
        expect(findAnswer('hello there')).toMatch(/Spaceverse assistant/);
    });

    it('returns null from findAnswer for off-topic questions', () => {
        expect(findAnswer('best banana bread recipe')).toBeNull();
        expect(findAnswer('who won the football on saturday')).toBeNull();
    });

    it('answerSpaceQuestion still returns a helpful string for off-topic input', () => {
        const a = answerSpaceQuestion('best banana bread recipe');
        expect(typeof a).toBe('string');
        expect(a).toMatch(/offline|Space Traffic Simulator|orbital mechanics/i);
    });
});
