#!/usr/bin/env node

(async (): Promise<void> => {
  if (process.argv.includes('login')) {
    require('./login');
  } else {
    console.error('Invalid Command');
    process.exit(1);
  }
})();
