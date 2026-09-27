import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  dts: true,
  outDir: 'lib',
  platform: 'node',
  target: 'node20',
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  // fzstd (pure-JS zstd decompressor) is bundled so the degraded raw-scan
  // path needs no new runtime dependency in the host profile.
  noExternal: ['fzstd'],
})
