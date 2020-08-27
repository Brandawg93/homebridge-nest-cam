import { Logging, PlatformConfig } from 'homebridge';
import { NestEndpoints, handleError } from './endpoints';
import { Face } from './models/structure-info';
import { CameraInfo } from './models/camera-info';

export class NestStructure {
  private config: PlatformConfig;
  private readonly log: Logging;
  public id = '';
  private apiHost = '';
  private endpoints: NestEndpoints;
  private faces: Array<Face> = [];

  constructor(cameraInfo: CameraInfo, config: PlatformConfig, log: Logging) {
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
}
