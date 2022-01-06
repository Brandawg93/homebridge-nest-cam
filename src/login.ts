import { generateToken, getRefreshToken } from './nest/connection';
import * as readline from 'readline';

// Prompt for user input
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
  const ft = process.argv.includes('-ft');
  const url = generateToken(ft);
  console.log(`1. Open the url below in a browser to continue:\n\n${url}\n`);
  const code = await prompt('2. Copy the code here: ');
  try {
    const refreshToken = await getRefreshToken(code, ft);
    console.log('3. Copy the refresh token below to your config.json.');
    console.log(`Refresh Token: ${refreshToken}`);
  } catch (err: any) {
    let msg = err;
    if (err.response?.data?.error_description) {
      msg = err.response?.data?.error_description;
    } else if (err.message) {
      msg = err.message;
    }
    console.error(msg);
  }
})();
