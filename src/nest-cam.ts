import { HAP, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';
import { NestEndpoints, handleError } from './nest-endpoints';
import { CameraInfo, Properties } from './models/camera-info';
import querystring from 'querystring';
import { EventEmitter } from 'events';

type OnlyBooleans<T> = Pick<
  T,
  {
    [K in keyof T]: T[K] extends boolean ? K : never;
  }[keyof T]
>;

const sanitizeString = (str: string): string => {
  if (str.includes('package')) {
    // Package
    return str.replace('-', ' ').replace(/(?:^|\s|["'([{])+\S/g, (match) => match.toUpperCase());
  } else if (str.includes('face')) {
    // Face
    return str.replace('-', ' - ').replace('face', 'Face');
  } else {
    // Motion, Person, Sound
    return str.replace(/(?:^|\s|["'([{])+\S/g, (match) => match.toUpperCase());
  }
};

export const enum NestCamEvents {
  CAMERA_STATE_CHANGED = 'camera-change',
  CHIME_STATE_CHANGED = 'chime-change',
  AUDIO_STATE_CHANGED = 'audio-change',
  DOORBELL_RANG = 'doorbell-rang',
  MOTION_DETECTED = 'motion-detected',
}

export class NestCam extends EventEmitter {
  private readonly config: PlatformConfig;
  private readonly log: Logging;
  private endpoints: NestEndpoints;
  private readonly hap: HAP;
  public info: CameraInfo;
  private accessory: PlatformAccessory;
  private motionDetected = false;
  private motionInProgress = false;
  private doorbellRang = false;
  private importantOnly = true;
  private alertTypes = ['Motion', 'Sound', 'Person', 'Package Delivered', 'Package Retrieved', 'Face'];
  private alertCooldown = 180000;
  private alertInterval = 10000;
  private alertTimeout: NodeJS.Timeout | undefined | number;
  private alertFailures = 0;
  private alertsSend = true;

  constructor(config: PlatformConfig, info: CameraInfo, accessory: PlatformAccessory, log: Logging, hap: HAP) {
    super();
    this.hap = hap;
    this.log = log;
    this.config = config;
    this.accessory = accessory;
    this.info = info;
    this.alertCooldown = (config.options?.alertCooldownRate || 180) * 1000;
    this.alertInterval = (this.config.options?.alertCheckRate || 10) * 1000;
    this.endpoints = new NestEndpoints(config.fieldTest);

    const alertTypes = config.options?.alertTypes;
    if (typeof alertTypes !== 'undefined') {
      this.alertTypes = alertTypes.slice();
    }
    const importantOnly = config.options?.importantOnly;
    if (typeof importantOnly !== 'undefined') {
      this.importantOnly = importantOnly;
    }
  }

  private async setBooleanProperty(
    key: keyof OnlyBooleans<Properties>,
    value: boolean,
    service: Service | undefined,
    event?: NestCamEvents,
  ): Promise<void> {
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
          this.info.properties[key] = value;
          event && this.emit(event);
        }
      }
    } catch (error) {
      handleError(this.log, error, `Error setting property for ${this.info.name}`);
    }
  }

  getAlertTypes(): Array<string> {
    if (this.info.capabilities.includes('stranger_detection')) {
      return this.alertTypes;
    } else {
      // Remove 'Package Delivered', 'Package Retrieved', 'Face'
      const remove = ['Package Delivered', 'Package Retrieved', 'Face'];
      return this.alertTypes.filter((x) => !remove.includes(x));
    }
  }

  async toggleActive(enabled: boolean): Promise<void> {
    const service = this.accessory.getService(`${this.accessory.displayName} Streaming`);
    await this.setBooleanProperty('streaming.enabled', enabled, service, NestCamEvents.CAMERA_STATE_CHANGED);
  }

  async toggleChime(enabled: boolean): Promise<void> {
    const service = this.accessory.getService(`${this.accessory.displayName} Chime`);
    await this.setBooleanProperty('doorbell.indoor_chime.enabled', enabled, service, NestCamEvents.CHIME_STATE_CHANGED);
  }

  async toggleAudio(enabled: boolean): Promise<void> {
    const service = this.accessory.getService(`${this.accessory.displayName} Audio`);
    await this.setBooleanProperty('audio.enabled', enabled, service, NestCamEvents.AUDIO_STATE_CHANGED);
  }

  startAlertChecks() {
    if (!this.alertTimeout) {
      const self = this;
      this.alertTimeout = setInterval(async function () {
        self.checkAlerts();
      }, this.alertInterval);
    }
  }

  stopAlertChecks() {
    if (this.alertTimeout && typeof this.alertTimeout == 'number') {
      clearInterval(this.alertTimeout);
    }
  }

  public async checkAlerts(): Promise<void> {
    if (!this.alertsSend) {
      return;
    }
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
        this.alertFailures = 0;
        if (response.length > 0) {
          for (let i = 0; i < response.length; i++) {
            const trigger = response[i];
            // Add face to alert if name is not empty
            if (trigger.face_name) {
              trigger.types?.push(`face-${trigger.face_name}`);
            }

            // Check importantOnly flag
            let important = true;
            if (this.importantOnly) {
              important = trigger.is_important;
            }

            if (important && trigger.types.includes('doorbell') && !this.doorbellRang) {
              this.triggerDoorbell();
              break;
            }

            if (important && !this.motionDetected) {
              if (trigger.types && trigger.types.length > 0) {
                this.triggerMotion(trigger.types);
              } else {
                this.triggerMotion(['Motion']);
              }
              break;
            }
          }
        } else if (this.motionInProgress) {
          self.setMotion(false, this.alertTypes);
          this.motionInProgress = false;
        }
      }
    } catch (error) {
      handleError(this.log, error, 'Error checking alerts');
      this.alertFailures++;
      this.alertsSend = false;
      setTimeout(() => {
        this.alertsSend = true;
      }, this.alertInterval * Math.pow(this.alertFailures, 2));
    }
  }

  triggerMotion(types: Array<string>): void {
    const self = this;
    this.setMotion(true, types);
    this.motionDetected = true;
    this.motionInProgress = true;

    setTimeout(async function () {
      self.motionDetected = false;
    }, this.alertCooldown);
  }

  private setMotion(state: boolean, types: Array<string>): void {
    types.forEach((type) => {
      type = sanitizeString(type);
      const service = this.accessory.getService(`${this.accessory.displayName} ${type}`);
      if (service) {
        this.log.debug(`Setting ${this.accessory.displayName} ${type} Motion to ${state}`);
        service.updateCharacteristic(this.hap.Characteristic.MotionDetected, state);
        this.emit(NestCamEvents.MOTION_DETECTED, state);
      }
    });
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
    const doorbellService = this.accessory.getService(`${this.accessory.displayName} Doorbell`);
    if (doorbellService) {
      this.log.debug(`Ringing ${this.accessory.displayName} Doorbell`);
      doorbellService.updateCharacteristic(
        this.hap.Characteristic.ProgrammableSwitchEvent,
        this.hap.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
      );
      this.emit(NestCamEvents.DOORBELL_RANG, true);
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
