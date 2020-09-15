import { HAP, Logging, PlatformAccessory, Service } from 'homebridge';
import { NestEndpoints, handleError } from './endpoints';
import { CameraInfo, Properties, Zone } from './models/camera';
import { NestConfig } from './models/config';
import { MotionEvent } from './models/event';
import { NestStructure } from './structure';
import { Face } from './models/structure';
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
  } else if (str.startsWith('Face') || str.startsWith('Zone')) {
    return str;
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
  private readonly config: NestConfig;
  private readonly log: Logging;
  private endpoints: NestEndpoints;
  private readonly hap: HAP;
  public info: CameraInfo;
  private zones: Array<Zone> = [];
  private accessory: PlatformAccessory;
  private motionDetected = false;
  private doorbellRang = false;
  private importantOnly = true;
  private alertTypes = ['Motion', 'Sound', 'Person', 'Package Delivered', 'Package Retrieved', 'Face', 'Zone'];
  private alertCooldown = 180000;
  private alertInterval = 10000;
  private alertTimeout: NodeJS.Timeout | undefined;
  private alertFailures = 0;
  private alertsSend = true;
  private lastUpdatedTime: Date;

  constructor(config: NestConfig, info: CameraInfo, accessory: PlatformAccessory, log: Logging, hap: HAP) {
    super();
    this.hap = hap;
    this.log = log;
    this.config = config;
    this.accessory = accessory;
    this.info = info;
    this.lastUpdatedTime = new Date();
    this.alertCooldown = (config.options?.alertCooldownRate || 180) * 1000;
    if (this.alertCooldown > 300000) {
      this.alertCooldown = 300000;
    }
    this.alertInterval = (config.options?.alertCheckRate || 10) * 1000;
    if (this.alertInterval > 60000) {
      this.alertInterval = 60000;
    }
    this.endpoints = new NestEndpoints(config.fieldTest);

    const alertTypes = config.options?.alertTypes;
    if (typeof alertTypes !== 'undefined') {
      log.debug(`Using alertTypes from config: ${alertTypes}`);
      this.alertTypes = alertTypes.slice();
    }
    const importantOnly = config.options?.importantOnly;
    if (typeof importantOnly !== 'undefined') {
      log.debug(`Using importantOnly from config: ${importantOnly}`);
      this.importantOnly = importantOnly;
    }

    // Setup events
    this.on(NestCamEvents.CAMERA_STATE_CHANGED, (value: boolean) => {
      const service = this.accessory.getService(`${this.accessory.displayName} Streaming`);
      service && service.updateCharacteristic(this.hap.Characteristic.On, value);
    });
    this.on(NestCamEvents.CHIME_STATE_CHANGED, (value: boolean) => {
      const service = this.accessory.getService(`${this.accessory.displayName} Chime`);
      service && service.updateCharacteristic(this.hap.Characteristic.On, value);
    });
    this.on(NestCamEvents.AUDIO_STATE_CHANGED, (value: boolean) => {
      const service = this.accessory.getService(`${this.accessory.displayName} Audio`);
      service && service.updateCharacteristic(this.hap.Characteristic.On, value);
    });
  }

  private async setBooleanProperty(
    key: keyof OnlyBooleans<Properties>,
    value: boolean,
    service: Service | undefined,
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
        }
      }
    } catch (error) {
      handleError(this.log, error, `Error setting property for ${this.info.name}`);
    }
  }

  async getAlertTypes(): Promise<Array<string>> {
    const useZones = this.alertTypes.includes('Zone');
    const index = this.alertTypes.indexOf('Zone');
    if (index > -1) {
      this.alertTypes.splice(index, 1);
    }
    if (useZones) {
      const zones = await this.getZones();
      zones.forEach((zone) => {
        this.log.debug(`Found zone ${zone.label} for ${this.info.name}`);
        this.alertTypes.push(`Zone - ${zone.label}`);
      });
    }

    if (this.info.capabilities.includes('stranger_detection')) {
      this.log.debug(`${this.info.name} has stranger_detection`);
      const useFaces = this.alertTypes.includes('Face');
      const index = this.alertTypes.indexOf('Face');
      if (index > -1) {
        this.alertTypes.splice(index, 1);
      }
      if (useFaces) {
        const structureId = this.info.nest_structure_id.replace('structure.', '');
        const structure = new NestStructure(this.info, this.config, this.log);
        const faces = await structure.getFaces();
        if (faces) {
          faces.forEach((face: Face) => {
            if (face.name) {
              this.log.debug(`Found face ${face.name} for ${structureId}`);
              this.alertTypes.push(`Face - ${face.name}`);
            }
          });
        }
      }

      return this.alertTypes;
    } else {
      // Remove 'Package Delivered', 'Package Retrieved', 'Face'
      const remove = ['Package Delivered', 'Package Retrieved', 'Face'];
      return this.alertTypes.filter((x) => !remove.includes(x));
    }
  }

  async toggleActive(enabled: boolean): Promise<void> {
    const service = this.accessory.getService(`${this.accessory.displayName} Streaming`);
    await this.setBooleanProperty('streaming.enabled', enabled, service);
  }

  async toggleChime(enabled: boolean): Promise<void> {
    const service = this.accessory.getService(`${this.accessory.displayName} Chime`);
    await this.setBooleanProperty('doorbell.indoor_chime.enabled', enabled, service);
  }

  async toggleAudio(enabled: boolean): Promise<void> {
    const service = this.accessory.getService(`${this.accessory.displayName} Audio`);
    await this.setBooleanProperty('audio.enabled', enabled, service);
  }

  startAlertChecks(): void {
    if (!this.alertTimeout) {
      const self = this;
      this.alertTimeout = setInterval(async () => {
        await self.checkAlerts();
      }, this.alertInterval) as NodeJS.Timeout;
    }
  }

  stopAlertChecks(): void {
    if (this.alertTimeout) {
      clearInterval(this.alertTimeout);
      this.alertTimeout = void 0;
      this.setMotion(false, this.alertTypes);
    }
  }

  async checkAlerts(): Promise<void> {
    if (!this.alertsSend) {
      return;
    }
    if (!this.info.properties['streaming.enabled']) {
      this.setMotion(false, this.alertTypes);
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
      const self = this;
      const response: Array<MotionEvent> = await this.endpoints.sendRequest(
        this.config.access_token,
        `https://${this.info.nexus_api_nest_domain_host}`,
        `/cuepoint/${this.info.uuid}/2?${query}`,
        'GET',
      );
      this.alertFailures = 0;
      if (response.length > 0) {
        response.forEach((trigger) => {
          // Add face to alert if name is not empty
          if (trigger.face_name) {
            this.log.debug(`Found face for ${trigger.face_name} in event`);
            trigger.types?.push(`Face - ${trigger.face_name}`);

            //If there is a face, there is a person
            if (!trigger.types?.includes('person')) {
              trigger.types?.push('person');
            }
          }

          if (trigger.zone_ids.length > 0) {
            trigger.zone_ids.forEach((zone_id) => {
              const zone = this.zones.find((x) => x.id === zone_id);
              if (zone) {
                this.log.debug(`Found zone for ${zone.label} in event`);
                trigger.types.push(`Zone - ${zone.label}`);
              }
            });
          }

          // Check importantOnly flag
          let important = true;
          if (this.importantOnly) {
            important = trigger.is_important;
          }

          if (important && trigger.types.includes('doorbell') && !this.doorbellRang) {
            this.triggerDoorbell();
          }

          if (important && !this.motionDetected) {
            if (trigger.types && trigger.types.length > 0) {
              this.triggerMotion(trigger.types);
            } else {
              this.triggerMotion(['Motion']);
            }
          }
        });
      } else {
        self.setMotion(false, this.alertTypes);
      }
    } catch (error) {
      handleError(this.log, error, 'Error checking alerts');
      if (this.alertFailures < 10) {
        this.alertFailures++;
      }
      this.alertsSend = false;
      setTimeout(() => {
        this.alertsSend = true;
      }, this.alertInterval * Math.pow(this.alertFailures, 2));
    }
  }

  async getZones(): Promise<Array<Zone>> {
    try {
      const response: Array<Zone> = await this.endpoints.sendRequest(
        this.config.access_token,
        `https://${this.info.nexus_api_nest_domain_host}`,
        `/cuepoint_category/${this.info.uuid}`,
        'GET',
      );

      const validZones: Array<Zone> = [];
      response.forEach((zone) => {
        if (zone.label && !zone.hidden && zone.type === 'region') {
          validZones.push(zone);
        }
      });

      this.zones = validZones;
      return validZones;
    } catch (error) {
      handleError(this.log, error, `Error getting zones for ${this.info.name} camera`);
    }

    return [];
  }

  async updateData(): Promise<CameraInfo> {
    // Only update if more than one second has elapsed
    const checkTime = new Date(this.lastUpdatedTime);
    checkTime.setSeconds(checkTime.getSeconds() + 1);
    if (new Date().getTime() < checkTime.getTime()) {
      return this.info;
    }

    const query = querystring.stringify({
      uuid: this.info.uuid,
    });

    try {
      const response: any = await this.endpoints.sendRequest(
        this.config.access_token,
        this.endpoints.CAMERA_API_HOSTNAME,
        `/api/cameras.get_with_properties?${query}`,
        'GET',
      );

      const info = response.items[0];
      if (info) {
        this.info = info;
        this.lastUpdatedTime = new Date();
      }
    } catch (error) {
      handleError(this.log, error, `Error updating ${this.info.name} camera`);
    }

    return this.info;
  }

  triggerMotion(types: Array<string>): void {
    const self = this;
    this.setMotion(true, types);
    this.motionDetected = true;

    setTimeout(async () => {
      self.motionDetected = false;
      self.log.debug('Cooldown has ended');
    }, this.alertCooldown);
  }

  private setMotion(state: boolean, types: Array<string>): void {
    if (this.hap) {
      types.forEach((type) => {
        type = sanitizeString(type);
        const service = this.accessory.getServiceById(
          this.hap.Service.MotionSensor,
          `${this.accessory.displayName} ${type}`,
        );
        if (service) {
          this.log.debug(`Setting ${this.accessory.displayName} ${type} Motion to ${state}`);
          service.updateCharacteristic(this.hap.Characteristic.MotionDetected, state);
          this.emit(NestCamEvents.MOTION_DETECTED, state);
        }
      });
    }
  }

  triggerDoorbell(): void {
    const self = this;
    this.setDoorbell();
    this.doorbellRang = true;
    setTimeout(() => {
      self.doorbellRang = false;
    }, this.alertCooldown);
  }

  private setDoorbell(): void {
    const doorbellService = this.accessory.getServiceById(
      this.hap.Service.Doorbell,
      `${this.accessory.displayName} Doorbell`,
    );
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
