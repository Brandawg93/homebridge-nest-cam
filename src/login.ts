import Browser from 'puppeteer-core';
import puppeteer from 'puppeteer-extra';
import pluginStealth from 'puppeteer-extra-plugin-stealth';
import * as os from 'os';
import * as readline from 'readline';
import * as path from 'path';
import * as fs from 'fs';
import { HomebridgeUI } from './uix';
import execa from 'execa';

const whichChromiumBrowser = async (binary: string): Promise<string> => {
  try {
    const output = await execa('which', [binary]);
    return output.stdout;
  } catch (err) {
    return '';
  }
};

export async function getChromiumBrowser(): Promise<string> {
  const platform = os.platform();
  const binaryNames = ['chromium', 'chromium-browser', 'chrome', 'google-chrome'];
  const userDefinedChromiumPath = process.argv.includes('-p')
    ? process.argv[process.argv.indexOf('-p') + 1]
    : undefined;

  // user defined path overrides everything
  if (userDefinedChromiumPath) {
    return userDefinedChromiumPath;
  }

  // if we are on x64 then using the chromium provided by puppeteer is ok
  if (os.arch() === 'x64') {
    if (fs.existsSync(Browser.executablePath())) {
      return Browser.executablePath();
    }
  }

  // try and find an existing copy of chrome / chromium
  let possiblePaths: Array<string> = [];

  if (platform === 'linux' || platform === 'freebsd') {
    const searchPaths = [
      '/usr/local/sbin',
      '/usr/local/bin',
      '/usr/sbin',
      '/usr/bin',
      '/sbin',
      '/bin',
      '/opt/google/chrome',
    ];

    for (const searchPath of searchPaths) {
      possiblePaths = possiblePaths.concat(binaryNames.map((x) => path.join(searchPath, x)));
    }
  }

  if (platform === 'darwin') {
    possiblePaths = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  }

  if (platform === 'win32') {
    possiblePaths = [
      path.join(process.env['ProgramFiles(x86)'] || '', '\\Google\\Chrome\\Application\\chrome.exe'),
      path.join(process.env['ProgramFiles(x86)'] || '', '\\Google\\Application\\chrome.exe'),
    ];
  }

  const availableBinaries = possiblePaths.filter((x) => fs.existsSync(x));

  if (availableBinaries.length) {
    return availableBinaries[0];
  }

  // attempt to find binary with "which" command
  if (platform === 'linux' || platform === 'freebsd' || platform === 'darwin') {
    for (const bin of binaryNames) {
      const whichPath = await whichChromiumBrowser(bin);
      if (whichPath) {
        return whichPath;
      }
    }
  }

  return '';
}

export async function login(email?: string, password?: string, uix?: HomebridgeUI): Promise<void> {
  let clientId = '';
  let loginHint = '';
  let cookies = '';
  let domain = '';

  const executablePath = await getChromiumBrowser();

  if (!executablePath) {
    console.error('Cannot find Chromium or Google Chrome installed on your system.');

    setTimeout(() => {
      process.exit(1);
    }, 100);
  }

  puppeteer.use(pluginStealth());

  let browser: Browser.Browser;
  const headless = !process.argv.includes('-h');

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

  const inputData = async function (
    identifier: string,
    alias: 'username' | 'password' | 'totp',
    message: string,
    value: string | undefined,
    page: Browser.Page,
  ): Promise<void> {
    let badInput = true;
    while (badInput) {
      if (!value) {
        value = (await prompt(alias, message, alias === 'password')) || '';
      }
      await page.type(identifier, value);
      await page.waitFor(500);
      await page.keyboard.press('Enter');
      try {
        await page.waitForSelector(`${identifier}[aria-invalid="true"]`, { timeout: 500 });
      } catch (err) {
        badInput = false;
      }
      if (badInput) {
        value = undefined;
        console.error(`Incorrect ${alias}. Please try again.`);
        await page.click(identifier, { clickCount: 3 });
      }
    }
  };

  try {
    const options: Browser.LaunchOptions = { headless: headless };
    options.executablePath = executablePath;
    options.args = [];

    // need some extra flags if running as root
    if (os.userInfo().uid === 0) {
      options.args.push('--no-sandbox', '--disable-setuid-sandbox');
    }

    browser = await puppeteer.launch(options);
  } catch (err) {
    console.error(
      `Unable to open chromium browser at path: ${executablePath}. You may need to install chromium manually and try again.`,
    );
    if (uix) {
      uix.loginFailed('Unable to open chromium.');
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
      await page.waitFor(500);
      await page.click('button[data-test="google-button-login"]');

      await page.waitForSelector('#identifierId');
      await inputData('#identifierId', 'username', 'Email or phone: ', email, page);
      await inputData('input[type="password"]', 'password', 'Password: ', password, page);

      console.log('Finishing up...');
      try {
        await page.waitForSelector('figure[data-illustration="authzenGmailApp"]', { timeout: 1000 });
        console.log('Open the Gmail app and tap Yes on the prompt to sign in.');
      } catch (error) {
        // Gmail 2FA is not enabled
      }
    }

    await page.setRequestInterception(true);
    page.on('request', async (request: any) => {
      const headers = request.headers();
      const url = request.url();
      // Getting cookies
      if (!cookies && url.includes('CheckCookie')) {
        cookies = (await page.cookies())
          .map((cookie: any) => {
            return `${cookie.name}=${cookie.value}`;
          })
          .join('; ');
      }

      // Building issueToken
      if (!clientId && url.includes('CheckCookie')) {
        const postData = url.split('&');
        clientId = postData.find((query: string) => query.includes('client_id=')).slice(10);
      }

      // Getting domain
      if (!domain && url.includes('issue_jwt')) {
        domain = encodeURIComponent(headers['origin'] || 'https://home.nest.com');
      }

      // Build googleAuth object
      if (clientId && loginHint && domain && cookies) {
        const auth = {
          issueToken: `https://accounts.google.com/o/oauth2/iframerpc?action=issueToken&response_type=token%20id_token&login_hint=${loginHint}&client_id=${clientId}&origin=${domain}&scope=openid%20profile%20email%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fnest-account&ss_domain=${domain}`,
          cookies: cookies,
        };

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
      if (!loginHint && response.url().includes('consent?')) {
        const headers = response.headers();
        if (headers.location) {
          const queries = headers.location.split('&');
          loginHint = queries.find((query: string) => query.includes('login_hint=')).slice(11);
        }
      }
    });

    // the two factor catch is after the page interceptors intentionally
    try {
      await page.waitForSelector('input[name="totpPin"]', { timeout: 5000 });
      console.log('2-step Verification Required');

      await inputData(
        'input[name="totpPin"]',
        'totp',
        'Please enter the verification code from the Google Authenticator app: ',
        undefined,
        page,
      );
    } catch (e) {
      // totp is not enabled
    }
  } catch (err) {
    console.error('Unable to retrieve credentials.');
    console.error(err);
    if (uix) {
      uix.loginFailed('An error occured while trying to get load generate token.');
    }
    try {
      browser.close();
    } catch (e) {}
  }
}

if (process.env.UIX_NEST_CAM_INTERACTIVE_LOGIN !== '1') {
  (async (): Promise<void> => {
    await login();
  })();
}
