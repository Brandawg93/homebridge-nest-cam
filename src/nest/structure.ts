import { Logging } from 'homebridge';
import { NestEndpoints, handleError } from './endpoints';
import { Face, Member } from './models/structure';
import { CameraInfo } from './models/camera';
import { NestConfig } from './models/config';
import axios from 'axios';
import { AxiosRequestConfig } from 'axios';

export class NestStructure {
  private config: NestConfig;
  private readonly log: Logging | undefined;
  public id = '';
  private apiHost = '';
  private endpoints: NestEndpoints;
  private faces: Array<Face> = [];

  constructor(cameraInfo: CameraInfo, config: NestConfig, log?: Logging) {
    this.id = cameraInfo.nest_structure_id.replace('structure.', '');
    this.apiHost = cameraInfo.nexus_api_nest_domain_host;
    this.config = config;
    this.log = log;
    this.endpoints = new NestEndpoints(config.fieldTest);
  }

  async getFaces(): Promise<Array<Face>> {
    if (this.faces.length > 0) {
      return this.faces;
    }
    try {
      const response = await this.endpoints.sendRequest(
        this.config.access_token,
        `https://${this.apiHost}`,
        `/faces/${this.id}`,
        'GET',
      );
      if (response && response.length > 0) {
        this.faces = response;
        return response;
      }
    } catch (error) {
      handleError(this.log, error, 'Error getting faces');
    }
    return [];
  }

  async getMembers(): Promise<Array<Member>> {
    try {
      const req: AxiosRequestConfig = {
        method: 'GET',
        url: `${this.endpoints.NEST_API_HOSTNAME}/api/0.1/structure/${this.id}/members`,
        headers: {
          Authorization: 'Basic ' + this.config.access_token,
          'User-Agent': NestEndpoints.USER_AGENT_STRING,
          Referer: this.endpoints.NEST_API_HOSTNAME,
          Cookie: `user_token=${this.config.access_token}`,
        },
      };
      return (await axios(req)).data.members as Array<Member>;
    } catch (error) {
      handleError(this.log, error, 'Error getting members');
    }
    return [];
  }
}
