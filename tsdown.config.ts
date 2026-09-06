import { defineConfig } from 'tsdown'

export default defineConfig([{
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'node22',
  fixedExtension: false,
  dts: false,
  sourcemap: true,
  clean: false,
  deps: { neverBundle: [/^@deepseek-ai\//] },
}, {
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  clean: false,
  dts: false,
  sourcemap: true,
  // The browser module table answers exactly the platform seed words; every
  // other import must be inlined or the factory throws at materialization.
  deps: {
    neverBundle: ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/cordis'],
    alwaysBundle: [/^\.\//, /^\.\.\//],
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "dsh-version-inventory", factory: (require) => {',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    footer: 'return module.exports; } });',
  },
}])
