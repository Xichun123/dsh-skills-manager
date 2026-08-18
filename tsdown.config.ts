import { defineConfig } from 'tsdown'

const packageName = 'dsh-skills-manager'

export default defineConfig([
  {
    name: packageName,
    entry: { index: 'lib/types/index.js' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    fixedExtension: false,
    dts: false,
    clean: false,
    external: [
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-home-paths',
      '@deepseek-ai/dsh-skill',
      '@deepseek-ai/dsh-skill-filesystem',
      '@deepseek-ai/schemastery',
      'skills',
    ],
  },
  {
    name: `${packageName}/client`,
    entry: { client: 'lib/types/client/index.js' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    fixedExtension: false,
    dts: false,
    sourcemap: true,
    clean: false,
    external: ['react'],
    noExternal: (id: string) => id === 'react' ? undefined : true,
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(packageName)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
