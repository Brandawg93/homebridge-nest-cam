import {
  AudioStreamingCodecType,
  AudioStreamingSamplerate,
  CameraControllerOptions,
  CharacteristicEventTypes,
  CharacteristicGetCallback,
  CharacteristicSetCallback,
  CharacteristicValue,
  HAP,
  Logging,
  PlatformAccessory,
  PlatformConfig,
  Service,
  WithUUID,
} from 'homebridge';
import { StreamingDelegate } from './streaming-delegate';
import { NestCam, NestCamEvents } from './nest/cam';
import { Properties } from './nest/models/camera';

type ServiceType = WithUUID<typeof Service>;

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

export class NestAccessory {
  private readonly log: Logging;
  private readonly hap: HAP;
  private accessory: PlatformAccessory;
  private camera: NestCam;
  private config: PlatformConfig;

  constructor(accessory: PlatformAccessory, camera: NestCam, config: PlatformConfig, log: Logging, hap: HAP) {
    this.accessory = accessory;
    this.camera = camera;
    this.config = config;
    this.log = log;
    this.hap = hap;

    // Setup events
    camera.on(NestCamEvents.CAMERA_STATE_CHANGED, (value: boolean) => {
      const service = this.accessory.getService(`${this.accessory.displayName} Streaming`);
      service && service.updateCharacteristic(this.hap.Characteristic.On, value);
    });
    camera.on(NestCamEvents.CHIME_STATE_CHANGED, (value: boolean) => {
      const service = this.accessory.getService(`${this.accessory.displayName} Chime`);
      service && service.updateCharacteristic(this.hap.Characteristic.On, value);
    });
    camera.on(NestCamEvents.AUDIO_STATE_CHANGED, (value: boolean) => {
      const service = this.accessory.getService(`${this.accessory.displayName} Audio`);
      service && service.updateCharacteristic(this.hap.Characteristic.On, value);
    });
    camera.on(NestCamEvents.MOTION_DETECTED, (state: boolean, alertTypes: Array<string>) => {
      this.setMotion(state, alertTypes);
    });
    camera.on(NestCamEvents.DOORBELL_RANG, () => {
      this.setDoorbell();
    });
  }

  createService(serviceType: ServiceType, name?: string): Service {
    const existingService = name
      ? this.accessory.getServiceById(serviceType, `${this.accessory.displayName} ${name}`)
      : this.accessory.getService(serviceType);

    const service =
      existingService ||
      (name
        ? this.accessory.addService(
            serviceType,
            `${this.accessory.displayName} ${name}`,
            `${this.accessory.displayName} ${name}`,
          )
        : this.accessory.addService(serviceType, this.accessory.displayName));
    return service;
  }

  removeService(serviceType: ServiceType, name?: string): void {
    const existingService = name
      ? this.accessory.getServiceById(serviceType, `${this.accessory.displayName} ${name}`)
      : this.accessory.getService(serviceType);

    if (existingService) {
      this.accessory.removeService(existingService);
    }
  }

  createSwitchService(
    name: string,
    serviceType: ServiceType,
    _key: keyof Properties,
    cb: (value: CharacteristicValue) => void,
  ): void {
    const service = this.createService(serviceType, name);
    this.log.debug(`Creating switch for ${this.accessory.displayName} ${name}.`);
    service
      .setCharacteristic(this.hap.Characteristic.On, this.camera.info.properties[_key])
      .getCharacteristic(this.hap.Characteristic.On)
      .on(CharacteristicEventTypes.SET, async (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        cb(value);
        this.log.info(`Setting ${this.accessory.displayName} to ${value ? 'on' : 'off'}`);
        callback();
      })
      .on(CharacteristicEventTypes.GET, async (callback: CharacteristicGetCallback) => {
        const info = await this.camera.updateData();
        this.accessory.context.cameraInfo = info;
        const value = info.properties[_key];
        if (typeof value !== 'undefined') {
          this.log.debug(`Updating info for ${this.accessory.displayName} ${name}`);
          callback(null, value);
        } else {
          callback(new Error(), undefined);
        }
      });
  }

  configureController(): void {
    const streamingDelegate = new StreamingDelegate(this.hap, this.camera, this.config, this.log);
    const options: CameraControllerOptions = {
      cameraStreamCount: 2, // HomeKit requires at least 2 streams, but 1 is also just fine
      delegate: streamingDelegate,
      streamingOptions: {
        supportedCryptoSuites: [this.hap.SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80],
        video: {
          resolutions: [
            [320, 180, 30],
            [320, 240, 15], // Apple Watch requires this configuration
            [320, 240, 30],
            [480, 270, 30],
            [480, 360, 30],
            [640, 360, 30],
            [640, 480, 30],
            [1280, 720, 30],
            [1280, 960, 30],
            [1920, 1080, 30],
            [1600, 1200, 30],
          ],
          codec: {
            profiles: [this.hap.H264Profile.BASELINE, this.hap.H264Profile.MAIN, this.hap.H264Profile.HIGH],
            levels: [this.hap.H264Level.LEVEL3_1, this.hap.H264Level.LEVEL3_2, this.hap.H264Level.LEVEL4_0],
          },
        },
        audio: {
          twoWayAudio: this.camera.info.capabilities.includes('audio.microphone'),
          codecs: [
            {
              type: AudioStreamingCodecType.AAC_ELD,
              samplerate: AudioStreamingSamplerate.KHZ_16,
            },
          ],
        },
      },
    };

    const cameraController = new this.hap.CameraController(options);
    streamingDelegate.controller = cameraController;

    this.accessory.configureController(cameraController);
  }

  getServicesByType(serviceType: ServiceType): Array<Service> {
    return this.accessory.services.filter((x) => x.UUID === serviceType.UUID);
  }

  async toggleActive(enabled: boolean): Promise<void> {
    const service = this.accessory.getService(`${this.accessory.displayName} Streaming`);
    const set = await this.camera.setBooleanProperty('streaming.enabled', enabled);
    if (set && service) {
      service.updateCharacteristic(this.hap.Characteristic.On, enabled);
    }
  }

  async toggleChime(enabled: boolean): Promise<void> {
    const service = this.accessory.getService(`${this.accessory.displayName} Chime`);
    const set = await this.camera.setBooleanProperty('doorbell.indoor_chime.enabled', enabled);
    if (set && service) {
      service.updateCharacteristic(this.hap.Characteristic.On, enabled);
    }
  }

  async toggleAudio(enabled: boolean): Promise<void> {
    const service = this.accessory.getService(`${this.accessory.displayName} Audio`);
    const set = await this.camera.setBooleanProperty('audio.enabled', enabled);
    if (set && service) {
      service.updateCharacteristic(this.hap.Characteristic.On, enabled);
    }
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
        }
      });
    }
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
