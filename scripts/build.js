#!/usr/bin/env node
const esbuild = require('esbuild');
const fs = require('fs-extra');
const path = require('path');

async function build() {
  try {
    // Concatenate and minify JavaScript files (preserving global variable structure)
    const jsFiles = [
      'abis.js',
      'config.js', 
      'ui-state-manager.js',
      'retry-helper.js',
      'tx-notifications.js',
      'wallet.js',
      'ui_interactions.js',
      'kyber.js',
      'score.js',
      'analytics.js',
      'trollbox.js',
      'app.js',
      'analytics-integration.js',
      'custom-chart-manager.js',
      'option-type-filter.js'
    ];

    // Read and concatenate all JS files
    let concatenatedJS = '';
    for (const file of jsFiles) {
      if (await fs.pathExists(file)) {
        const content = await fs.readFile(file, 'utf8');
        concatenatedJS += `\n// === ${file} ===\n${content}\n`;
      }
    }

    // Write the concatenated file first
    await fs.writeFile('temp-bundle.js', concatenatedJS);

    // Now minify the concatenated file
    await esbuild.build({
      entryPoints: ['temp-bundle.js'],
      outfile: 'dist/app.bundle.js',
      bundle: false,  // Don't bundle since we already concatenated
      minify: true,   // Minify to hide source code
      sourcemap: false,  // No source maps
      target: ['es2022'],
      format: 'iife',
      platform: 'browser'
    });

    // Clean up temp file
    await fs.remove('temp-bundle.js');
    console.log('Built dist/app.bundle.js (concatenated and minified)');

    // Build the TypeScript bridge
    await esbuild.build({
      entryPoints: ['web3onboard-bridge.ts'],
      outfile: 'dist/web3onboard-bridge.js',
      bundle: true,
      minify: true,  // Also minify this for consistency
      sourcemap: false,
      target: ['es2022'],
      format: 'iife',
      globalName: 'Web3OnboardBridge',
      platform: 'browser',
      loader: { '.ts': 'ts' }
    });
    console.log('Built dist/web3onboard-bridge.js (minified)');

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
    
    // Copy individual files (excluding individual JS files since they're now bundled)
    const filesToCopy = [
      'index.html',
      'app.html',
      'app.css',
      'trollbox.css',
      'tx-notifications.css',
      'landing.css',
      'trollbox-admin.html',
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
    
    // Copy the bundled files
    await fs.ensureDir('public/dist');
    await fs.copy('dist/app.bundle.js', 'public/dist/app.bundle.js');
    console.log('Copied dist/app.bundle.js to public/dist/');
    
    await fs.copy('dist/web3onboard-bridge.js', 'public/dist/web3onboard-bridge.js');
    console.log('Copied dist/web3onboard-bridge.js to public/dist/');
    
    console.log('Build completed successfully!');
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

build();


