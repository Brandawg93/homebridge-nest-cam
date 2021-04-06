import { HomebridgePluginUiServer } from '@homebridge/plugin-ui-utils';
import { auth, getCameras, generateToken, getRefreshToken } from '../nest/connection';
import { NestConfig } from '../nest/models/config';
import { Member } from '../nest/models/structure';
import { NestStructure } from '../nest/structure';
import { CameraInfo } from '../nest/models/camera';

interface Structure {
  title: string;
  enum: Array<string>;
}

export class UiServer extends HomebridgePluginUiServer {
  private accessToken?: string;
  private cameras?: Array<CameraInfo>;
  private ft = false;

  constructor() {
    super();

    this.onRequest('/logout', this.handleLogoutRequest.bind(this));
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

  async handleLogoutRequest(): Promise<void> {
    this.cameras = undefined;
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

  async setCredentials(credentials: string): Promise<void> {
    await this.sendToParent({ action: 'credentials', payload: credentials });
  }

  async showError(msg: string): Promise<void> {
    await this.sendToParent({
      action: 'error',
      payload: msg,
    });
  }

  async handleGenerateTokenRequest(payload: any): Promise<string> {
    return generateToken(payload.ft);
  }

  async handleGetRefreshTokenRequest(payload: any): Promise<string> {
    if (!payload.code) {
      return '';
    }
    try {
      return await getRefreshToken(payload.code, payload.ft);
    } catch (err) {
      let msg = err;
      if (err.response?.data?.error_description) {
        msg = err.response?.data?.error_description;
      } else if (err.message) {
        msg = err.message;
      }
      await this.showError(msg);
    }
    return '';
  }
}

// start the instance of the class
((): UiServer => {
  return new UiServer();
})();
