#!/usr/bin/env node
const esbuild = require('esbuild');

async function build() {
  try {
    await esbuild.build({
      entryPoints: ['web3onboard-bridge.ts'],
      outfile: 'dist/web3onboard-bridge.js',
      bundle: true,
      minify: false,
      sourcemap: false,
      target: ['es2022'],
      format: 'iife',
      globalName: 'Web3OnboardBridge',
      platform: 'browser',
      loader: { '.ts': 'ts' }
    });
    console.log('Built dist/web3onboard-bridge.js');
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

build();


