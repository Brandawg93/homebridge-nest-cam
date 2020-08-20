import Browser from 'puppeteer';
import puppeteer from 'puppeteer-extra';
import pluginStealth from 'puppeteer-extra-plugin-stealth';
import * as readline from 'readline';
import { HomebridgeUI } from './uix';

export async function login(email?: string, password?: string, uix?: HomebridgeUI): Promise<void> {
  let clientId = '';
  let loginHint = '';
  let cookies = '';
  let domain = '';

  puppeteer.use(pluginStealth());

  let browser: Browser.Browser;
  const headless = !process.argv.includes('-h');
  const path = (): string => {
    if (process.argv.includes('-p')) {
      const index = process.argv.indexOf('-p');
      return process.argv[index + 1];
    }
    return '';
  };
  const prompt = (key: 'username' | 'password' | 'totp', query: string, hidden = false): Promise<string> =>
    new Promise(async (resolve, reject) => {
      // handle uix prompts
      if (uix) {
        switch (key) {
          case 'username': {
            return resolve(await uix.getUsername());
          }
          case 'password': {
            return resolve(await uix.getPassword());
          }
          case 'totp': {
            return resolve(await uix.getTotp());
          }
          default: {
            return reject(Error(`Unhandled Prompt Key: ${key}`));
          }
        }
      }

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      try {
        if (hidden) {
          const stdin = process.openStdin();
          process.stdin.on('data', (char: string) => {
            char = char + '';
            switch (char) {
              case '\n':
              case '\r':
              case '\u0004':
                stdin.pause();
                break;
              default:
                process.stdout.clearLine(0);
                readline.cursorTo(process.stdout, 0);
                process.stdout.write(query + Array(rl.line.length + 1).join('*'));
                break;
            }
          });
        }
        rl.question(query, (value) => {
          resolve(value);
          rl.close();
        });
      } catch (err) {
        reject(err);
      }
    });

  try {
    const options: any = { headless: headless };
    const executablePath = path();
    if (executablePath) {
      options.executablePath = path();
    }
    browser = await puppeteer.launch(options);
  } catch (err) {
    if (path) {
      console.error(`Unable to open chromium browser at path ${path}`);
    } else {
      console.error(
        'Unable to open chromium browser. Install chromium manually and specify its path using the "-p" flag.',
      );
    }
    return;
  }

  try {
    console.log('Opening chromium browser...');
    const page = await browser.newPage();
    const pages = await browser.pages();
    pages[0].close();
    await page.evaluateOnNewDocument(() => {
      const newProto = Object.getPrototypeOf(navigator);
      delete newProto.webdriver;
      Object.setPrototypeOf(navigator, newProto);
    });
    await page.goto('https://home.nest.com', { waitUntil: 'networkidle2' });
    if (headless) {
      await page.waitForSelector('button[data-test="google-button-login"]');
      await page.waitFor(1000);
      await page.click('button[data-test="google-button-login"]');

      await page.waitForSelector('#identifierId');
      let badUsername = true;
      while (badUsername) {
        if (!email) {
          email = await prompt('username', 'Email or phone: ');
        }
        await page.type('#identifierId', email);
        await page.waitFor(1000);
        await page.keyboard.press('Enter');
        await page.waitFor(1000);
        badUsername = await page.evaluate(() => document.querySelector('#identifierId[aria-invalid="true"]') !== null);
        if (badUsername) {
          email = undefined;
          console.log('Incorrect email or phone. Please try again.');
          await page.click('#identifierId', { clickCount: 3 });
        }
      }

      let badPassword = true;

      while (badPassword) {
        if (!password) {
          password = await prompt('password', 'Enter your password: ', true);
        }

        console.log('Logging in...');

        await page.waitFor(500);
        await page.type('input[type="password"]', password);
        await page.waitFor(1000);
        await page.keyboard.press('Enter');
        await page.waitFor(1000);
        badPassword = await page.evaluate(
          () => document.querySelector('input[type="password"][aria-invalid="true"]') !== null,
        );

        if (badPassword) {
          password = undefined;
          console.log('Invalid password. Please try again.');
          await page.click('input[type="password"]', { clickCount: 3 });
        }
      }

      console.log('Finishing up...');
    }

    await page.setRequestInterception(true);
    page.on('request', async (request: any) => {
      const headers = request.headers();
      const url = request.url();
      // Getting cookies
      if (url.includes('CheckCookie')) {
        cookies = (await page.cookies())
          .map((cookie: any) => {
            return `${cookie.name}=${cookie.value}`;
          })
          .join('; ');
      }

      // Building issueToken
      if (url.includes('challenge?')) {
        const postData = request.postData().split('&');
        clientId = postData.find((query: string) => query.includes('client_id=')).slice(10);
      }

      // Getting apiKey
      if (url.includes('issue_jwt') && headers['x-goog-api-key']) {
        domain = encodeURIComponent(headers['referer'].slice(0, -1));
      }

      // Build googleAuth object
      if (clientId && loginHint && cookies) {
        const auth = {
          issueToken: `https://accounts.google.com/o/oauth2/iframerpc?action=issueToken&response_type=token%20id_token&login_hint=${loginHint}&client_id=${clientId}&origin=${domain}&scope=openid%20profile%20email%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fnest-account&ss_domain=${domain}`,
          cookies: cookies,
        };
        // console.log('Add the following to your config.json:\n');

        if (uix) {
          uix.setCredentials(auth);
        } else {
          console.log('"googleAuth":', JSON.stringify(auth, null, 4));
        }
        browser.close();
      }

      // Auth didn't work
      if (url.includes('cameras.get_owned_and_member_of_with_properties')) {
        if (uix) {
          uix.loginFailed('Could not generate "googleAuth" object.');
        } else {
          console.log('Could not generate "googleAuth" object.');
        }
        browser.close();
      }

      request.continue();
    });

    page.on('response', async (response: any) => {
      // Building issueToken
      if (response.url().includes('consent?')) {
        const headers = response.headers();
        if (headers.location) {
          const queries = headers.location.split('&');
          loginHint = queries.find((query: string) => query.includes('login_hint=')).slice(11);
        }
      }
    });

    // the two factor catch is after the page interceptors intentionally
    try {
      await page.waitForSelector('input[name=totpPin]', { timeout: 5000 });
      console.log('2-step Verification Required');
      await page.waitFor(1000);

      let badTotpCode = true;

      while (badTotpCode) {
        const totp = await prompt(
          'totp',
          'Please enter the verification code from the Google Authenticator app: ',
          true,
        );
        await page.type('input[name=totpPin]', totp);
        await page.waitFor(1000);
        await page.keyboard.press('Enter');
        await page.waitFor(1000);
        badTotpCode = await page.evaluate(() => document.querySelector('#totpPin[aria-invalid="true"]') !== null);
        if (badTotpCode) {
          await page.click('#totpPin[aria-invalid="true"]', { clickCount: 3 });
        }
      }
    } catch (e) {
      // totp is not enabled
    }
  } catch (err) {
    console.error('Unable to retrieve credentials.');
    console.error(err);
  }
}

if (process.env.UIX_NEST_CAM_INTERACTIVE_LOGIN !== '1') {
  (async (): Promise<void> => {
    await login();
  })();
}
