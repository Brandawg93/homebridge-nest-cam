import { HAP, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';
import { NestEndpoints } from './nest-endpoints';
import { CameraInfo } from './camera-info';
import querystring from 'querystring';

const handleError = function (log: Logging, error: any, message: string): void {
  if (error.response) {
    const status = parseInt(error.response.status);
    if (status >= 500) {
      log.debug(`${message}: ${status}`);
    } else {
      log.error(`${message}: ${status}`);
    }
  } else {
    log.error(error);
  }
};

export class NestCam {
  private readonly config: PlatformConfig;
  private readonly log: Logging;
  private endpoints: NestEndpoints;
  private readonly hap: HAP;
  public info: CameraInfo;
  private accessory: PlatformAccessory;
  private motionDetected = false;
  private motionInProgress = false;
  private doorbellRang = false;
  private alertTypes: Array<string> = [];
  private alertCooldown = 180000;

  constructor(config: PlatformConfig, info: CameraInfo, accessory: PlatformAccessory, log: Logging, hap: HAP) {
    this.hap = hap;
    this.log = log;
    this.config = config;
    this.accessory = accessory;
    this.info = info;
    this.alertTypes = config.options.alertTypes || [];
    this.alertCooldown = (config.options.alertCooldownRate || 180) * 1000;
    this.endpoints = new NestEndpoints(config.options.fieldTest);
  }

  private async setProperty(
    key: string,
    value: string | number | boolean,
    service: Service | undefined,
  ): Promise<boolean> {
    const query = querystring.stringify({
      [key]: value,
      uuid: this.info.uuid,
    });

    const response = await this.endpoints.sendRequest(
      this.config.access_token,
      this.endpoints.CAMERA_API_HOSTNAME,
      '/api/dropcams.set_properties',
      'POST',
      'json',
      query,
    );

    try {
      if (response.status !== 0) {
        this.log.error(`Unable to set property '${key}' for ${this.info.name} to ${value}`);
      } else {
        if (service) {
          service.updateCharacteristic(this.hap.Characteristic.On, value);
          return true;
        }
      }
    } catch (error) {
      handleError(this.log, error, `Error setting property for ${this.info.name}`);
    }
    return false;
  }

  async toggleActive(enabled: boolean): Promise<void> {
    const service = this.accessory.getService('Streaming');
    if (await this.setProperty('streaming.enabled', enabled, service)) {
      this.info.properties['streaming.enabled'] = enabled;
    }
  }

  async toggleChime(enabled: boolean): Promise<void> {
    const service = this.accessory.getService('Chime');
    if (await this.setProperty('doorbell.indoor_chime.enabled', enabled, service)) {
      this.info.properties['doorbell.indoor_chime.enabled'] = enabled;
    }
  }

  async toggleAudio(enabled: boolean): Promise<void> {
    const service = this.accessory.getService('Audio');
    if (await this.setProperty('audio.enabled', enabled, service)) {
      this.info.properties['audio.enabled'] = enabled;
    }
  }

  async checkAlerts(): Promise<void> {
    this.log.debug(`Checking for alerts on ${this.accessory.displayName}`);
    try {
      const currDate = new Date();
      currDate.setMinutes(currDate.getMinutes() - 1);
      const epoch = Math.round(currDate.getTime() / 1000);
      const query = querystring.stringify({
        start_time: epoch,
      });
      if (!this.accessory.context.removed) {
        const self = this;
        const response = await this.endpoints.sendRequest(
          this.config.access_token,
          `https://${this.info.nexus_api_nest_domain_host}`,
          `/cuepoint/${this.info.uuid}/2?${query}`,
          'GET',
        );
        if (response.length > 0) {
          for (let i = 0; i < response.length; i++) {
            const trigger = response[i];
            if (trigger.is_important && trigger.types.includes('doorbell') && !this.doorbellRang) {
              this.triggerDoorbell();
              break;
            }

            // Check the intersection between user defined alert types and received alerts
            let intersection = trigger.types;
            if (this.alertTypes.length > 0) {
              intersection = this.alertTypes.filter((type) => trigger.types.includes(type));
            }
            if (trigger.is_important && intersection.length > 0 && !this.motionDetected) {
              this.triggerMotion();
              break;
            }
          }
        } else if (this.motionInProgress) {
          self.setMotion(false);
          this.motionInProgress = false;
        }
      }
    } catch (error) {
      handleError(this.log, error, 'Error checking alerts');
    }
  }

  triggerMotion(): void {
    const self = this;
    this.setMotion(true);
    this.motionDetected = true;
    this.motionInProgress = true;

    setTimeout(async function () {
      self.motionDetected = false;
    }, this.alertCooldown);
  }

  private setMotion(state: boolean): void {
    this.log.debug(`Setting ${this.accessory.displayName} Motion to ${state}`);
    const service = this.accessory.getService(this.hap.Service.MotionSensor);
    if (service) {
      service.updateCharacteristic(this.hap.Characteristic.MotionDetected, state);
    }
  }

  triggerDoorbell(): void {
    const self = this;
    this.setDoorbell();
    this.doorbellRang = true;
    setTimeout(function () {
      self.doorbellRang = false;
    }, this.alertCooldown);
  }

  private setDoorbell(): void {
    this.log.debug(`Ringing ${this.accessory.displayName} Doorbell`);
    const doorbellService = this.accessory.getService(this.hap.Service.Doorbell);
    if (doorbellService) {
      doorbellService.updateCharacteristic(
        this.hap.Characteristic.ProgrammableSwitchEvent,
        this.hap.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
      );
    }

    const switchService = this.accessory.getService(this.hap.Service.StatelessProgrammableSwitch);
    if (switchService) {
      switchService.updateCharacteristic(
        this.hap.Characteristic.ProgrammableSwitchEvent,
        this.hap.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
      );
    }
  }
}
