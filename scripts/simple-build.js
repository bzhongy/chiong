#!/usr/bin/env node
const fs = require('fs-extra');
const path = require('path');

async function simpleBuild() {
  try {
    // Create public directory
    await fs.ensureDir('public');
    
    // Copy all HTML, CSS, JS files to public directory
    const files = fs.readdirSync('.');
    
    for (const file of files) {
      const filePath = path.join('.', file);
      const stat = fs.statSync(filePath);
      
      if (stat.isFile()) {
        const ext = path.extname(file);
        if (['.html', '.css', '.js', '.md', '.sol'].includes(ext)) {
          await fs.copy(filePath, `public/${file}`);
          console.log(`Copied ${file} to public/`);
        }
      } else if (stat.isDirectory() && !['node_modules', '.git', 'dist', 'public'].includes(file)) {
        await fs.copy(filePath, `public/${file}`);
        console.log(`Copied ${file}/ to public/`);
      }
    }
    
    // Copy the built web3onboard-bridge.js if it exists
    if (await fs.pathExists('dist/web3onboard-bridge.js')) {
      await fs.ensureDir('public/dist');
      await fs.copy('dist/web3onboard-bridge.js', 'public/dist/web3onboard-bridge.js');
      console.log('Copied dist/web3onboard-bridge.js to public/dist/');
    }
    
    console.log('Simple build completed successfully!');
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

simpleBuild();
