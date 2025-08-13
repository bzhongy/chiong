#!/usr/bin/env node
const esbuild = require('esbuild');
const fs = require('fs-extra');
const path = require('path');

async function build() {
  try {
    // Build the TypeScript bridge
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

    // Create public directory
    await fs.ensureDir('public');
    
    // Copy all static files to public directory
    const staticFiles = [
      '*.html',
      '*.css', 
      '*.js',
      '*.md',
      '*.sol',
      'img/**/*',
      'analysis/**/*'
    ];
    
    // Copy individual files
    const filesToCopy = [
      'index.html',
      'app.html',
      'app.css',
      'app.js',
      'config.js',
      'wallet.js',
      'ui_interactions.js',
      'kyber.js',
      'score.js',
      'analytics.js',
      'price-alerts.js',
      'ui-state-manager.js',
      'trollbox.js',
      'trollbox.css',
      'tx-notifications.js',
      'tx-notifications.css',
      'option-type-filter.js',
      'retry-helper.js',
      'custom-chart-manager.js',
      'analytics-integration.js',
      'time-decay-visualization.js',
      'leverage-visualization.js',
      'landing.css',
      'landing.js',
      'trollbox-admin.html',
      'trollbox-admin.js',
      'test-notifications.html',
      'test-analytics.html',
      'userBrowser.html',
      'README.md',
      'TROLLBOX_ADMIN_SETUP.md',
      'TRANSACTION_NOTIFICATIONS_README.md',
      'WEB3ONBOARD_MIGRATION.md',
      'OptionBook.sol'
    ];
    
    for (const file of filesToCopy) {
      if (await fs.pathExists(file)) {
        await fs.copy(file, `public/${file}`);
        console.log(`Copied ${file} to public/`);
      }
    }
    
    // Copy directories
    const dirsToCopy = ['img', 'analysis'];
    for (const dir of dirsToCopy) {
      if (await fs.pathExists(dir)) {
        await fs.copy(dir, `public/${dir}`);
        console.log(`Copied ${dir}/ to public/`);
      }
    }
    
    // Copy the built web3onboard-bridge.js
    await fs.copy('dist/web3onboard-bridge.js', 'public/dist/web3onboard-bridge.js');
    console.log('Copied dist/web3onboard-bridge.js to public/dist/');
    
    console.log('Build completed successfully!');
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

build();


