import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';
import Browser from 'puppeteer-core';

async function main() {
  if (os.arch() === 'x64') {
    // The browser bundled with puppeteer only supports x64 systems.
    if (fs.existsSync(Browser.executablePath())) {
      return;
    }

    if (canUseBundledChromium()) {
      try {
        await downloadBundledChromium();
        return;
      } catch (e) {
        console.error('Failed to download bundled Chromium:', e.message);
      }
    }
  }

  if (os.platform() !== 'linux') {
    // we only need to continue to run this script on linux
    return;
  }

  // try and find an existing copy of chrome / chromium
  let possiblePaths: Array<string> = [];

  const searchPaths = [
    '/usr/local/sbin',
    '/usr/local/bin',
    '/usr/sbin',
    '/usr/bin',
    '/sbin',
    '/bin',
    '/opt/google/chrome',
  ];

  const binaryNames = ['chromium', 'chromium-browser', 'chrome', 'google-chrome'];

  for (const searchPath of searchPaths) {
    possiblePaths = possiblePaths.concat(binaryNames.map((x) => path.join(searchPath, x)));
  }

  try {
    // check if an existing copy of chrome exists
    const availableBinaries = possiblePaths.filter((x) => fs.existsSync(x));

    if (availableBinaries.length) {
      // we found a copy, exit time.
      return;
    }

    // work out the install command
    let installCommands: Array<any> = [];
    if (fs.existsSync('/usr/bin/apt-get')) {
      // debian / ubuntu / raspbian
      installCommands = [
        ['apt-get', ['update']],
        ['apt-get', ['-y', 'install', 'chromium-browser']],
      ];
    } else if (fs.existsSync('/sbin/apk')) {
      // alpine linux (docker)
      installCommands = [['apk', ['add', '--no-cache', 'chromium']]];
    } else if (fs.existsSync('/usr/bin/yum')) {
      // enterprise linux / centos
      installCommands = [
        ['yum', ['-y', 'update']],
        ['yum', ['-y', 'install', 'epel-release']],
        ['yum', ['-y', 'install', 'chromium']],
      ];
    }

    if (!installCommands.length || os.userInfo().uid !== 0) {
      console.error('Please install Chromium to use the account linking feature.');
      return;
    }

    // run the install commands
    for (const command of installCommands) {
      await runCommand(command);
    }
  } catch (e) {
    // log the error
    console.error(e.message);

    // we don't want to exit with non-zero code as it will cause the install to fail
    process.exit(0);
  }
}

function canUseBundledChromium() {
  switch (os.platform()) {
    case 'linux': {
      return fs.existsSync('/usr/bin/apt-get');
    }
    case 'win32': {
      return true;
    }
    case 'darwin': {
      return true;
    }
    default: {
      return false;
    }
  }
}

async function downloadBundledChromium() {
  const puppeteerInstallScript = path.resolve(__dirname, '../node_modules/puppeteer-core/install.js');

  if (!fs.existsSync(puppeteerInstallScript)) {
    throw new Error(`${puppeteerInstallScript} does not exist.`);
  }

  // get bundled chrome
  await runCommand([process.execPath, [puppeteerInstallScript]]);

  // install extra deps requires on debian-based linux
  if (os.platform() === 'linux' && fs.existsSync('/usr/bin/apt-get')) {
    await runCommand(['apt-get', ['update']]);
    await runCommand([
      'apt-get',
      [
        '-y',
        'install',
        'gconf-service',
        'libasound2',
        'libatk1.0-0',
        'libatk-bridge2.0-0',
        'libc6',
        'libcairo2',
        'libcups2',
        'libdbus-1-3',
        'libexpat1',
        'libfontconfig1',
        'libgcc1',
        'libgconf-2-4',
        'libgdk-pixbuf2.0-0',
        'libglib2.0-0',
        'libgtk-3-0',
        'libnspr4',
        'libpango-1.0-0',
        'libpangocairo-1.0-0',
        'libstdc++6',
        'libx11-6',
        'libx11-xcb1',
        'libxcb1',
        'libxcomposite1',
        'libxcursor1',
        'libxdamage1',
        'libxext6',
        'libxfixes3',
        'libxi6',
        'libxrandr2',
        'libxrender1',
        'libxss1',
        'libxtst6',
        'ca-certificates',
        'fonts-liberation',
        'libappindicator1',
        'libnss3',
        'lsb-release',
        'xdg-utils',
        'wget',
        'libgbm-dev',
      ],
    ]);
  }
}

function runCommand(installCommand: [string, Array<string>]) {
  return new Promise((resolve, reject) => {
    process.env.DEBIAN_FRONTEND = 'noninteractive';

    const command: string = installCommand[0];
    const args = installCommand[1];

    console.log('Running:', command, ...args);

    const installProcess = child_process.spawn(command, args, {
      stdio: 'inherit',
    });

    installProcess.on('close', (code) => {
      if (code !== 0) {
        return reject(code);
      }
      return resolve();
    });
  });
}

main();
