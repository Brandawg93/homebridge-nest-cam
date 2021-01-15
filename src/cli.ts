#!/usr/bin/env node

import { generateToken, getRefreshToken } from './nest/connection';
import * as readline from 'readline';

const prompt = (query: string): Promise<string> =>
  new Promise(async (resolve, reject) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      rl.question(query, (value) => {
        resolve(value);
        rl.close();
      });
    } catch (err) {
      reject(err);
    }
  });

(async (): Promise<void> => {
  if (process.argv.includes('login')) {
    require('./login');
  } else if (process.argv.includes('token')) {
    const ft = process.argv.includes('-ft');
    const token = generateToken(ft);
    const url = token.url;
    const code_verifier = token.code;
    console.log(`1. Open the url below in a browser to continue:\n\n${url}\n`);
    console.log('2. Open Developer Tools (View/Developer/Developer Tools).');
    console.log("3. Click on 'Network' tab. Make sure 'Preserve Log' is checked.");
    console.log("4. In the 'Filter' box, enter 'nest-account' and select 'Doc' for the filter type.");
    console.log('5. Login to your Google account.');
    console.log("6. Click on the call beginning with 'nest-account&authuser=...'");
    let requestUrl = await prompt(
      "7. Copy the entire Request Url (beginning with 'com.googleusercontent.apps') here: ",
    );
    try {
      requestUrl = requestUrl.replace('Request URL: ', '').split('?')[1];
    } catch (err) {
      console.error('Invalid request url');
    }
    const refreshToken = await getRefreshToken(requestUrl, code_verifier, ft);
    console.log('8. Copy the refresh token below to your config.json.');
    console.log(`Refresh Token: ${refreshToken}`);
  } else {
    console.error('Invalid Command');
    process.exit(1);
  }
})();
