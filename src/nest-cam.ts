import { HAP, Logging, PlatformAccessory, PlatformConfig } from 'homebridge';
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
  private motionDetected = false;
  private motionInProgress = false;
  private doorbellRang = false;
  private alertTypes: Array<string> = [];
  private alertCooldown = 180000;

  constructor(config: PlatformConfig, info: CameraInfo, log: Logging, hap: HAP) {
    this.hap = hap;
    this.log = log;
    this.config = config;
    this.info = info;
    this.alertTypes = config.options.alertTypes || [];
    this.alertCooldown = (config.options.alertCooldownRate || 180) * 1000;
    this.endpoints = new NestEndpoints(config.options.fieldTest);
  }

  async toggleActive(enabled: boolean, accessory: PlatformAccessory): Promise<void> {
    const query = querystring.stringify({
      'streaming.enabled': enabled,
      uuid: this.info.uuid,
    });
    try {
      const response = await this.endpoints.sendRequest(
        this.config.access_token,
        this.endpoints.CAMERA_API_HOSTNAME,
        '/api/dropcams.set_properties',
        'POST',
        'json',
        query,
      );
      if (response.status !== 0) {
        this.log.error(`Could not turn ${this.info.name} ${enabled ? 'on' : 'off'}`);
      } else {
        const service = accessory.getService(this.hap.Service.Switch);
        if (service) {
          service.updateCharacteristic(this.hap.Characteristic.On, enabled);
        }
      }
    } catch (error) {
      handleError(this.log, error, 'Error toggling camera state');
    }
  }

  async checkAlerts(accessory: PlatformAccessory): Promise<void> {
    this.log.debug(`Checking for alerts on ${accessory.displayName}`);
    try {
      const currDate = new Date();
      currDate.setMinutes(currDate.getMinutes() - 1);
      const epoch = Math.round(currDate.getTime() / 1000);
      const query = querystring.stringify({
        start_time: epoch,
      });
      if (!accessory.context.removed) {
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
              this.triggerDoorbell(accessory);
              break;
            }

            // Check the intersection between user defined alert types and received alerts
            let intersection = trigger.types;
            if (this.alertTypes.length > 0) {
              intersection = this.alertTypes.filter((type) => trigger.types.includes(type));
            }
            if (trigger.is_important && intersection.length > 0 && !this.motionDetected) {
              this.triggerMotion(accessory);
              break;
            }
          }
        } else if (this.motionInProgress) {
          self.setMotion(accessory, false);
          this.motionInProgress = false;
        }
      }
    } catch (error) {
      handleError(this.log, error, 'Error checking alerts');
    }
  }

  triggerMotion(accessory: PlatformAccessory): void {
    const self = this;
    this.setMotion(accessory, true);
    this.motionDetected = true;
    this.motionInProgress = true;

    setTimeout(async function () {
      self.motionDetected = false;
    }, this.alertCooldown);
  }

  setMotion(accessory: PlatformAccessory, state: boolean): void {
    this.log.debug(`Setting ${accessory.displayName} Motion to ${state}`);
    const service = accessory.getService(this.hap.Service.MotionSensor);
    if (service) {
      service.updateCharacteristic(this.hap.Characteristic.MotionDetected, state);
    }
  }

  triggerDoorbell(accessory: PlatformAccessory): void {
    const self = this;
    this.setDoorbell(accessory);
    this.doorbellRang = true;
    setTimeout(function () {
      self.doorbellRang = false;
    }, this.alertCooldown);
  }

  setDoorbell(accessory: PlatformAccessory): void {
    this.log.debug(`Ringing ${accessory.displayName} Doorbell`);
    const doorbellService = accessory.getService(this.hap.Service.Doorbell);
    if (doorbellService) {
      doorbellService.updateCharacteristic(
        this.hap.Characteristic.ProgrammableSwitchEvent,
        this.hap.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
      );
    }

    const switchService = accessory.getService(this.hap.Service.StatelessProgrammableSwitch);
    if (switchService) {
      switchService.updateCharacteristic(
        this.hap.Characteristic.ProgrammableSwitchEvent,
        this.hap.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
      );
    }
  }
}
