import {
  HAP,
  Logging,
  PlatformAccessory,
  PlatformConfig
} from 'homebridge';
import { NestEndpoints } from './nest-endpoints';
import querystring from 'querystring';

export interface CameraInfo {
  name: string;
  uuid: string;
  is_streaming_enabled: boolean;
  serial_number: string;
  combined_software_version: string;
  detectors: string[];
  type: number;
  direct_nexustalk_host: string;
  nexus_api_http_server: string;
}

export class NestCam {
  private readonly config: PlatformConfig;
  private readonly log: Logging;
  private endpoints: NestEndpoints;
  private readonly hap: HAP;
  private ffmpegCodec: string = 'libx264';
  private pathToFfmpeg: string = '';
  public name: string = '';
  public uuid: string = '';
  public enabled: boolean = false;
  private motionDetected: boolean = false;
  public serialNumber: string = '';
  public softwareVersion: string = '';
  public detectors: any;
  public type: number = -1;
  public nexusTalkHost: string = '';
  public apiHost: string = '';

  constructor(config: PlatformConfig, info: CameraInfo, log: Logging, hap: HAP) {
    this.hap = hap;
    this.log = log;
    this.config = config;
    this.endpoints = new NestEndpoints(config.options.fieldTest);
    this.setAttributes(info);
    this.motionDetected = false;
  }

  async updateInfo(): Promise<void> {
    let query = querystring.stringify({
      'uuid': this.uuid
    });
    try {
      this.log.debug(`Updating info for ${this.name}`);
      let response = await this.endpoints.sendRequest(this.config.access_token, this.endpoints.CAMERA_API_HOSTNAME, `/api/cameras.get_with_properties?${query}`, 'GET');
      response.items.forEach((info: any) => {
        this.setAttributes(info);
      });
    } catch(error) {
      if (error.response) {
        this.log.debug(`Error updating camera info: ${error.response.status}`);
      } else {
        this.log.error(error);
      }
    }
  }

  setAttributes(info: any): void {
    this.name = info.name;
    this.uuid = info.uuid;
    this.enabled = info.is_streaming_enabled;
    this.serialNumber = info.serial_number;
    this.softwareVersion = info.combined_software_version;
    this.detectors = info.detectors;
    this.type = info.type;
    this.nexusTalkHost = info.direct_nexustalk_host;
    this.apiHost = info.nexus_api_http_server;
  }

  async toggleActive(enabled: boolean): Promise<void> {
    let query = querystring.stringify({
      'streaming.enabled': enabled,
      'uuid': this.uuid
    });
    try {
      await this.endpoints.sendRequest(this.config.access_token, this.endpoints.CAMERA_API_HOSTNAME, '/api/dropcams.set_properties', 'POST', 'json', query);
      this.enabled = enabled;
    } catch(error) {
      if (error.response) {
        this.log.error(`Error toggling camera state: ${error.response.status}`);
      } else {
        this.log.error(error);
      }
    }
  }

  async checkMotion(accessory: PlatformAccessory): Promise<void> {
    this.log.debug(`Checking for motion on ${accessory.displayName}`);
    try {
      let currDate = new Date();
      currDate.setMinutes(currDate.getMinutes() - 1);
      const epoch = Math.round(currDate.getTime() / 1000);
      let query = querystring.stringify({
        'start_time': epoch
      });
      let response = await this.endpoints.sendRequest(this.config.access_token, this.apiHost, `/cuepoint/${this.uuid}/2?${query}`, 'GET');
      if (response.length > 0) {
        let trigger = response[0];
        if (trigger.is_important && !this.motionDetected) {
          this.setMotion(accessory, true);
        }
      } else if (this.motionDetected) {
        this.setMotion(accessory, false);
      }
    } catch(error) {
      if (error.response) {
        this.log.debug(`Error checking motion: ${error.response.status}`);
      } else {
        this.log.error(error);
      }
    }
  }

  setMotion(accessory: PlatformAccessory, state: boolean): void {
    this.log.debug(`Setting ${accessory.displayName} Motion to ${state}`);
    let service = accessory.getService(this.hap.Service.MotionSensor);
    if (service) {
      service.updateCharacteristic(this.hap.Characteristic.MotionDetected, state);
      this.motionDetected = state;
    }
  }
}
