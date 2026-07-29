import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        // The app is CommonJS, so tests are too — they `require` it directly.
        // Vitest's own API cannot be require()d, so expose it as globals rather
        // than forcing every test file into ESM just to import describe/it.
        globals: true,
        // Each API test file spins up its own in-memory MongoDB and requires the
        // Express app, which registers Mongoose models globally. Running files in
        // parallel threads would have them fight over the same model registry and
        // the same mongoose default connection, so files run one at a time.
        fileParallelism: false,
        // mongodb-memory-server downloads a binary on first run.
        testTimeout: 30000,
        hookTimeout: 120000,
        include: ['tests/**/*.test.js']
    }
});
