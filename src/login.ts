let clientId = '';
let loginHint = '';
let cookies = '';
let apiKey = '';
let domain = '';

import puppeteer from 'puppeteer-extra';
import pluginStealth from 'puppeteer-extra-plugin-stealth';
puppeteer.use(pluginStealth());

puppeteer.launch({ headless: false }).then(async (browser: any) => {
  const page = await browser.newPage();
  const pages = await browser.pages();
  pages[0].close();
  await page.goto('https://home.nest.com', { waitUntil: 'networkidle2' });

  await page.setRequestInterception(true);
  page.on('request', async (request: any) => {
    const headers = request.headers();
    // Getting cookies
    if (request.url().includes('CheckCookie')) {
      cookies = (await page.cookies())
        .map((cookie: any) => {
          return `${cookie.name}=${cookie.value}`;
        })
        .join('; ');
    }

    // Building issueToken
    if (request.url().includes('challenge?')) {
      const postData = request.postData().split('&');
      clientId = postData.find((query: string) => query.includes('client_id=')).slice(10);
    }

    // Getting apiKey
    if (request.url().includes('issue_jwt') && headers['x-goog-api-key']) {
      apiKey = headers['x-goog-api-key'];
      domain = encodeURIComponent(headers['referer'].slice(0, -1));
    }

    if (apiKey && clientId && loginHint && cookies) {
      const auth = {
        googleAuth: {
          issueToken: `https://accounts.google.com/o/oauth2/iframerpc?action=issueToken&response_type=token%20id_token&login_hint=${loginHint}&client_id=${clientId}&origin=${domain}&scope=openid%20profile%20email%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fnest-account&ss_domain=${domain}`,
          cookies: cookies,
          apiKey: apiKey,
        },
      };
      console.log(JSON.stringify(auth, null, 4));
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
});
