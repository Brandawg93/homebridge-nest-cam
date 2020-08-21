#!/usr/bin/env node

/* eslint-disable @typescript-eslint/no-var-requires */

const child_process = require('child_process');

if (process.argv.includes('login')) {
  require('./dist/login');
} else if (process.argv.includes('clean')) {
  child_process.execSync('npm prune --production', {
      stdio: 'inherit',
      cwd: __dirname,
  });
} else {
  console.log('Invalid Command');
  process.exit(1);
}
