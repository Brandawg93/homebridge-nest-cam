#!/usr/bin/env node

/* eslint-disable @typescript-eslint/no-var-requires */

if (process.argv.includes('login')) {
  require('./dist/login');
} else {
  console.error('Invalid Command');
  process.exit(1);
}
