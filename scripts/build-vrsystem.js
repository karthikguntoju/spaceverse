const esbuild = require('esbuild');
const path = require('path');

(async () => {
  try {
    const outdir = path.join(__dirname, '..', 'public', 'js');
    await esbuild.build({
      entryPoints: [path.join(__dirname, 'vrsystem-entry.js')],
      bundle: true,
      minify: true,
      platform: 'browser',
      format: 'iife',
      globalName: 'VRSolarSystemBundle',
      outfile: path.join(outdir, 'vrsystem.bundle.js'),
      loader: { '.js': 'jsx', '.jsx': 'jsx' },
      define: { 'process.env.NODE_ENV': '"production"' },
      sourcemap: false,
      logLevel: 'silent'
    });
    console.log('VRSolarSystem bundle built at public/js/vrsystem.bundle.js');
  } catch (err) {
    console.error('Failed to build VRSolarSystem bundle:', err);
    process.exit(1);
  }
})();
