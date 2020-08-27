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
import { NestCam } from './nest/cam';
import { Properties } from './nest/models/camera-info';

type ServiceType = WithUUID<typeof Service>;

export class NestAccessory {
  private readonly log: Logging;
  private readonly hap: HAP;
  private accessory: PlatformAccessory;
  private config: PlatformConfig;

  constructor(accessory: PlatformAccessory, config: PlatformConfig, log: Logging, hap: HAP) {
    this.accessory = accessory;
    this.config = config;
    this.log = log;
    this.hap = hap;
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

  createSwitchService(
    name: string,
    serviceType: ServiceType,
    camera: NestCam,
    _key: keyof Properties,
    cb: (value: CharacteristicValue) => void,
  ): void {
    const service = this.createService(serviceType, name);
    this.log.debug(`Creating switch for ${this.accessory.displayName} ${name}.`);
    service
      .setCharacteristic(this.hap.Characteristic.On, camera.info.properties[_key])
      .getCharacteristic(this.hap.Characteristic.On)
      .on(CharacteristicEventTypes.SET, async (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        cb(value);
        this.log.info(`Setting ${this.accessory.displayName} to ${value ? 'on' : 'off'}`);
        callback();
      })
      .on(CharacteristicEventTypes.GET, async (callback: CharacteristicGetCallback) => {
        const info = await camera.updateData();
        const value = info.properties[_key];
        if (typeof value !== 'undefined') {
          this.log.debug(`Updating info for ${this.accessory.displayName} ${name}`);
          callback(null, value);
        } else {
          callback(new Error(), undefined);
        }
      });
  }

  configureController(camera: NestCam): void {
    const streamingDelegate = new StreamingDelegate(this.hap, camera, this.config, this.log);
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
          twoWayAudio: camera.info.capabilities.includes('audio.microphone'),
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
}
