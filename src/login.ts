import Browser from 'puppeteer';
import puppeteer from 'puppeteer-extra';
import pluginStealth from 'puppeteer-extra-plugin-stealth';
import * as readline from 'readline';

export async function login(email?: string, password?: string): Promise<void> {
  let clientId = '';
  let loginHint = '';
  let cookies = '';
  let apiKey = '';
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
  const prompt = (query: string, hidden = false): Promise<string> =>
    new Promise((resolve, reject) => {
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
    console.error(
      'Unable to open chromium browser. Install chromium manually and specify its path using the "-p" flag.',
    );
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
      let badInput = true;
      while (badInput) {
        if (!email) {
          email = await prompt('Email or phone: ');
        }
        await page.type('#identifierId', email);
        await page.waitFor(1000);
        await page.keyboard.press('Enter');
        await page.waitFor(1000);
        badInput = await page.evaluate(() => document.querySelector('#identifierId[aria-invalid="true"]') !== null);
        if (badInput) {
          console.log('Incorrect email or phone. Please try again.');
          await page.click('#identifierId', { clickCount: 3 });
        }
      }
      if (!password) {
        password = await prompt('Enter your password: ', true);
      }
      console.log('Finishing up...');
      await page.type('input[type="password"]', password);
      await page.waitFor(1000);
      await page.keyboard.press('Enter');
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
        apiKey = headers['x-goog-api-key'];
        domain = encodeURIComponent(headers['referer'].slice(0, -1));
      }

      // Build googleAuth object
      if (apiKey && clientId && loginHint && cookies) {
        const auth = {
          issueToken: `https://accounts.google.com/o/oauth2/iframerpc?action=issueToken&response_type=token%20id_token&login_hint=${loginHint}&client_id=${clientId}&origin=${domain}&scope=openid%20profile%20email%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fnest-account&ss_domain=${domain}`,
          cookies: cookies,
          apiKey: apiKey,
        };
        // console.log('Add the following to your config.json:\n');
        console.log('"googleAuth":', JSON.stringify(auth, null, 4));
        browser.close();
      }

      // Auth didn't work
      if (url.includes('cameras.get_owned_and_member_of_with_properties')) {
        console.log('Could not generate "googleAuth" object.');
        browser.close();
      }

      request.continue();
    });

    page.on('response', async (response: any) => {
      // Building issueToken
      if (response.url().includes('consent?')) {
        const headers = response.headers();
        const queries = headers.location.split('&');
        loginHint = queries.find((query: string) => query.includes('login_hint=')).slice(11);
      }
    });
  } catch (err) {
    console.error('Unable to retrieve credentials.');
    console.error(err);
  }
}

(async (): Promise<void> => {
  await login();
})();
