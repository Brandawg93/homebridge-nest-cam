import { EventEmitter } from 'events';

process.env.UIX_NEST_CAM_INTERACTIVE_LOGIN = '1';

process.title = 'homebridge-nest-cam-link-account';

export class HomebridgeUI extends EventEmitter {
  constructor() {
    super();

    process.addListener('message', (request: { action: string; payload?: any }) => {
      if (request.action) {
        this.emit(request.action, request.payload);
      }
    });

    this.on('doLogin', () => {
      this.doLogin();
    });
  }

  private async sendToParent(request: { action: string; payload?: any }): Promise<any> {
    if (process.send) {
      process.send(request);
      return new Promise((resolve) => {
        this.once(request.action, (payload: any) => {
          return resolve(payload);
        });
      });
    } else {
      throw new Error('Not running in child process');
    }
  }

  async doLogin() {
    try {
      const { login, getChromiumBrowser } = await import('./login');
      if (!getChromiumBrowser()) {
        this.sendToParent({
          action: 'error',
          payload: {
            key: 'chromium_not_found',
            message: 'Cannot find Chromium or Google Chrome installed on your system.',
          },
        });
      }
      await login(undefined, undefined, this);
    } catch (e) {
      this.sendToParent({ action: 'error', payload: e.message });
    }
  }

  async getUsername(): Promise<string> {
    const response = await this.sendToParent({ action: 'username' });
    return response.username;
  }

  async getPassword(): Promise<string> {
    const response = await this.sendToParent({ action: 'password' });
    return response.password;
  }

  async getTotp(): Promise<string> {
    const response = await this.sendToParent({ action: 'totp' });
    return response.totp;
  }

  async setCredentials(credentials: any) {
    await this.sendToParent({ action: 'credentials', payload: credentials });
  }

  async loginFailed(msg: string) {
    await this.sendToParent({
      action: 'error',
      payload: {
        key: 'login_failed',
        message: msg,
      },
    });
  }
}

// start the main class
(async (): Promise<void> => {
  new HomebridgeUI();
})();

// make sure the parent (ui) is still connected to avoid orphan processes
setInterval(() => {
  if (!process.connected) {
    process.kill(process.pid, 'SIGTERM');
  }
}, 10000);

process.on('disconnect', () => {
  process.kill(process.pid, 'SIGTERM');
});
