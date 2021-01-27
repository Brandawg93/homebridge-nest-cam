import { HomebridgePluginUiServer } from '@homebridge/plugin-ui-utils';
import { auth, getCameras, generateToken, getRefreshToken, Token } from '../nest/connection';
import { NestConfig } from '../nest/models/config';
import { Member } from '../nest/models/structure';
import { NestStructure } from '../nest/structure';
import { CameraInfo } from '../nest/models/camera';
import { AutoLogin, getChromiumBrowser } from '../util/login';

interface Structure {
  title: string;
  enum: Array<string>;
}

export class UiServer extends HomebridgePluginUiServer {
  private accessToken?: string;
  private cameras?: Array<CameraInfo>;
  private ft = false;
  private login: AutoLogin;
  private usernameRequested = false;
  private passwordRequested = false;

  constructor() {
    super();

    this.login = new AutoLogin();
    this.onRequest('/login', this.handleLoginRequest.bind(this));
    this.onRequest('/logout', this.handleLogoutRequest.bind(this));
    this.onRequest('/stop', this.handleStopRequest.bind(this));
    this.onRequest('/auth', this.handleAuthRequest.bind(this));
    this.onRequest('/structures', this.handleStructureRequest.bind(this));
    this.onRequest('/cameras', this.handleCamerasRequest.bind(this));
    this.onRequest('/owner', this.handleOwnerRequest.bind(this));
    this.onRequest('/generateToken', this.handleGenerateTokenRequest.bind(this));
    this.onRequest('/getRefreshToken', this.handleGetRefreshTokenRequest.bind(this));

    this.ready();
  }

  private generateConfig(): NestConfig | undefined {
    if (this.accessToken) {
      const config: NestConfig = {
        platform: 'Nest-cam',
        fieldTest: this.ft,
        access_token: this.accessToken,
      };
      return config;
    }
  }

  async handleAuthRequest(payload: any): Promise<boolean> {
    this.accessToken = await auth(payload.refreshToken, payload.ft);
    this.ft = payload.ft;
    return this.accessToken ? true : false;
  }

  async handleStructureRequest(): Promise<Array<Structure> | undefined> {
    const config = this.generateConfig();

    if (config) {
      const structures: Array<Structure> = [];
      const cameras = this.cameras || (await getCameras(config));
      this.cameras = cameras;
      cameras.forEach((cameraInfo) => {
        const exists = structures.find((x) => x.enum[0] === cameraInfo.nest_structure_id.replace('structure.', ''));
        if (!exists) {
          structures.push({
            title: cameraInfo.nest_structure_name,
            enum: [cameraInfo.nest_structure_id.replace('structure.', '')],
          });
        }
      });
      return structures;
    }
  }

  async handleOwnerRequest(): Promise<Member | undefined> {
    const config = this.generateConfig();

    if (config) {
      const cameras = this.cameras || (await getCameras(config));
      this.cameras = cameras;
      if (cameras && cameras.length > 0) {
        const structure = new NestStructure(cameras[0], config);
        const members = await structure.getMembers();
        const owner = members.find((m) => m.roles.includes('owner'));
        return owner;
      }
    }
  }

  async handleCamerasRequest(): Promise<Array<CameraInfo> | undefined> {
    const config = this.generateConfig();
    if (config) {
      const cameras = this.cameras || (await getCameras(config));
      this.cameras = cameras;
      return cameras;
    }
  }

  async handleLoginRequest(): Promise<void> {
    this.doLogin();
  }

  async handleLogoutRequest(): Promise<void> {
    this.cameras = undefined;
  }

  async handleStopRequest(): Promise<void> {
    this.stopLogin();
  }

  private async sendToParent(request: { action: string; payload?: any }): Promise<any> {
    const promise = new Promise((resolve) => {
      this.onRequest(
        `/${request.action}`,
        async (payload: any): Promise<any> => {
          return resolve(payload);
        },
      );
    });
    this.pushEvent(request.action, request.payload);
    return promise;
  }

  async doLogin(): Promise<void> {
    try {
      if (!(await getChromiumBrowser())) {
        this.sendToParent({
          action: 'error',
          payload: {
            key: 'chromium_not_found',
            message: 'Cannot find Chromium or Google Chrome installed on your system.',
          },
        });
      }
      await this.login.login(undefined, undefined, this);
    } catch (e) {
      this.sendToParent({ action: 'error', payload: e.message });
    }
  }

  stopLogin(): void {
    this.login.stop();
    this.usernameRequested = false;
    this.passwordRequested = false;
  }

  async getUsername(): Promise<string> {
    if (this.usernameRequested) {
      this.sendToParent({ action: 'error', payload: 'Invalid email' });
      this.stopLogin();
      return '';
    }
    this.usernameRequested = true;
    const response = await this.sendToParent({ action: 'username' });
    return response;
  }

  async getPassword(): Promise<string> {
    if (this.passwordRequested) {
      this.sendToParent({ action: 'error', payload: 'Invalid password' });
      this.stopLogin();
      return '';
    }
    this.passwordRequested = true;
    const response = await this.sendToParent({ action: 'password' });
    return response;
  }

  async getTotp(): Promise<string> {
    const response = await this.sendToParent({ action: 'totp' });
    return response;
  }

  async sendStartupSuccess(): Promise<void> {
    await this.pushEvent('started', {});
  }

  async setCredentials(credentials: string): Promise<void> {
    await this.sendToParent({ action: 'credentials', payload: credentials });
  }

  async showError(msg: string): Promise<void> {
    await this.sendToParent({
      action: 'error',
      payload: msg,
    });
  }

  async showNotice(msg: string): Promise<void> {
    await this.sendToParent({
      action: 'notice',
      payload: msg,
    });
  }

  async handleGenerateTokenRequest(payload: any): Promise<Token> {
    return generateToken(payload.ft);
  }

  async handleGetRefreshTokenRequest(payload: any): Promise<string> {
    if (!payload.code_verifier || !payload.url) {
      return '';
    }
    try {
      const requestUrl = payload.url.replace('Request URL: ', '').split('?')[1];
      return await getRefreshToken(requestUrl, payload.code_verifier, payload.ft);
    } catch (err) {
      console.error('Invalid request url');
    }
    return '';
  }
}

// start the instance of the class
((): UiServer => {
  return new UiServer();
})();
