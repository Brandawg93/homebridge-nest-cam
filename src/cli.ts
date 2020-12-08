#!/usr/bin/env node

if (process.argv.includes('login')) {
  require('./login');
} else {
  console.error('Invalid Command');
  process.exit(1);
}
