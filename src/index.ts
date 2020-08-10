import {
  API,
  APIEvent,
  AudioStreamingCodecType,
  AudioStreamingSamplerate,
  CameraControllerOptions,
  CharacteristicEventTypes,
  CharacteristicGetCallback,
  CharacteristicSetCallback,
  CharacteristicValue,
  DynamicPlatformPlugin,
  HAP,
  Logging,
  PlatformAccessory,
  PlatformAccessoryEvent,
  PlatformConfig,
} from 'homebridge';
import { NestCam } from './nest-cam';
import { NestStructure } from './nest-structure';
import { CameraInfo, ModelTypes, Properties } from './models/camera-info';
import { Face } from './models/structure-info';
import { NestEndpoints, handleError } from './nest-endpoints';
import { StreamingDelegate } from './streaming-delegate';
import { Connection } from './nest-connection';

class Options {
  motionDetection = true;
  doorbellAlerts = true;
  doorbellSwitch = true;
  streamingSwitch = true;
  chimeSwitch = true;
  audioSwitch = true;
}

let hap: HAP;
let Accessory: typeof PlatformAccessory;

const PLUGIN_NAME = 'homebridge-nest-cam';
const PLATFORM_NAME = 'Nest-cam';

class NestCamPlatform implements DynamicPlatformPlugin {
  private readonly log: Logging;
  private readonly api: API;
  private config: PlatformConfig;
  private options: Options;
  private endpoints: NestEndpoints = new NestEndpoints(false);
  private readonly accessories: Array<PlatformAccessory> = [];
  private readonly cameras: Array<NestCam> = [];
  private readonly nestStructures: Record<string, NestStructure> = {};
  private structures: Array<string> = [];

  constructor(log: Logging, config: PlatformConfig, api: API) {
    this.log = log;
    this.api = api;
    this.config = config;
    this.options = new Options();

    // Need a config or plugin will not start
    if (!config) {
      return;
    }

    this.initDefaultOptions();
    api.on(APIEvent.DID_FINISH_LAUNCHING, this.didFinishLaunching.bind(this));
  }

  private initDefaultOptions(): void {
    // Setup boolean options
    Object.keys(this.options).forEach((opt) => {
      const key = opt as keyof Options;
      const configVal = this.config.options[key];
      if (typeof configVal === 'undefined') {
        this.options[key] = true;
        this.log.debug(`Defaulting ${key} to true`);
      } else {
        this.options[key] = configVal;
        this.log.debug(`Using ${key} from config: ${configVal}`);
      }
    });

    const structures = this.config.options?.structures;
    if (typeof structures !== 'undefined') {
      this.log.debug(`Using structures from config: ${structures}`);
      this.structures = structures;
    } else {
      this.log.debug('Defaulting structures to []');
    }
  }

  private async setupConnection(): Promise<boolean> {
    if (!this.config.googleAuth) {
      this.log.error('You did not specify your Google account credentials, googleAuth, in config.json');
      return false;
    }

    if (
      this.config.googleAuth &&
      (!this.config.googleAuth.issueToken || !this.config.googleAuth.cookies || !this.config.googleAuth.apiKey)
    ) {
      this.log.error(
        'You must provide issueToken, cookies and apiKey in config.json. Please see README.md for instructions',
      );
      return false;
    }

    this.config.fieldTest = this.config.googleAuth.issueToken.includes('home.ft.nest.com');
    this.log.debug(`Setting Field Test to ${this.config.fieldTest}`);
    const conn = new Connection(this.config, this.log);
    return await conn.auth();
  }

  private createSwitchService(
    name: string,
    canCreate: boolean,
    accessory: PlatformAccessory,
    camera: NestCam,
    _key: keyof Properties,
    cb: (value: CharacteristicValue) => void,
  ): void {
    const oldService = accessory.getService(`${accessory.displayName} ${name}`);
    if (oldService) {
      this.log.debug(`Existing switch found for ${accessory.displayName} ${name}. Removing...`);
      accessory.removeService(oldService);
    }
    if (canCreate) {
      this.log.debug(`Creating switch for ${accessory.displayName} ${name}.`);

      const service = new hap.Service.Switch(`${accessory.displayName} ${name}`, `${accessory.displayName} ${name}`);
      service
        .setCharacteristic(hap.Characteristic.On, camera.info.properties[_key])
        .getCharacteristic(hap.Characteristic.On)
        .on(CharacteristicEventTypes.SET, async (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
          cb(value);
          this.log.info(`Setting ${accessory.displayName} to ${value ? 'on' : 'off'}`);
          callback();
        })
        .on(CharacteristicEventTypes.GET, async (callback: CharacteristicGetCallback) => {
          const info = await camera.updateData();
          const value = info.properties[_key];
          if (typeof value !== 'undefined') {
            this.log.debug(`Updating info for ${accessory.displayName} ${name}`);
            callback(null, value);
          } else {
            callback(new Error(), undefined);
          }
        });

      accessory.addService(service);
    }
  }

  private createMotionService(
    name: string,
    canCreate: boolean,
    accessory: PlatformAccessory | undefined,
    camera: NestCam,
  ): void {
    const service = accessory?.getService(`${accessory.displayName} ${name}`);
    if (service) {
      this.log.debug(`Existing motion sensor found for ${accessory?.displayName} ${name}. Removing...`);
      accessory?.removeService(service);
    }
    if (canCreate) {
      this.log.debug(`Creating motion sensor for ${accessory?.displayName} ${name}.`);
      accessory?.addService(
        new hap.Service.MotionSensor(`${accessory.displayName} ${name}`, `${accessory.displayName} ${name}`),
      );
      camera.startAlertChecks();
    }
  }

  private createDoorbellService(name: string, canCreate: boolean, accessory: PlatformAccessory, camera: NestCam): void {
    const service = accessory.getService(`${accessory.displayName} ${name}`);
    if (service) {
      accessory.removeService(service);
    }
    if (canCreate) {
      accessory.addService(
        new hap.Service.Doorbell(`${accessory.displayName} ${name}`, `${accessory.displayName} ${name}`),
      );
      camera.startAlertChecks();
    }
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info(`Configuring accessory ${accessory.displayName}`);

    accessory.on(PlatformAccessoryEvent.IDENTIFY, () => {
      this.log.info(`${accessory.displayName} identified!`);
    });

    const cameraInfo: CameraInfo = accessory.context.cameraInfo;
    const camera = new NestCam(this.config, cameraInfo, accessory, this.log, hap);
    const streamingDelegate = new StreamingDelegate(hap, camera, this.config, this.log);
    const options: CameraControllerOptions = {
      cameraStreamCount: 2, // HomeKit requires at least 2 streams, but 1 is also just fine
      delegate: streamingDelegate,
      streamingOptions: {
        supportedCryptoSuites: [hap.SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80],
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
            profiles: [hap.H264Profile.BASELINE, hap.H264Profile.MAIN, hap.H264Profile.HIGH],
            levels: [hap.H264Level.LEVEL3_1, hap.H264Level.LEVEL3_2, hap.H264Level.LEVEL4_0],
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

    const cameraController = new hap.CameraController(options);
    streamingDelegate.controller = cameraController;

    accessory.configureController(cameraController);

    // Configure services
    const microphone = accessory.getService(hap.Service.Microphone);
    const speaker = accessory.getService(hap.Service.Speaker);
    const doorbellSwitch = accessory.getService('DoorbellSwitch');

    // Microphone configuration
    microphone && accessory.removeService(microphone);
    speaker && accessory.removeService(speaker);

    // Add microphone service
    if (camera.info.capabilities.includes('audio.microphone')) {
      accessory
        .addService(hap.Service.Microphone)
        .getCharacteristic(hap.Characteristic.Mute)
        .on(CharacteristicEventTypes.GET, (callback: CharacteristicSetCallback) => {
          callback(null, false);
        });

      accessory
        .addService(hap.Service.Speaker)
        .getCharacteristic(hap.Characteristic.Mute)
        .on(CharacteristicEventTypes.GET, (callback: CharacteristicSetCallback) => {
          callback(null, false);
        });
    }

    // Remove the previous switch services
    let oldSwitchService = accessory.getService(hap.Service.Switch);
    while (oldSwitchService) {
      accessory.removeService(oldSwitchService);
      oldSwitchService = accessory.getService(hap.Service.Switch);
    }
    // Remove the previous motion services
    let oldMotionService = accessory.getService(hap.Service.MotionSensor);
    while (oldMotionService) {
      accessory.removeService(oldMotionService);
      oldMotionService = accessory.getService(hap.Service.MotionSensor);
    }
    // Remove the previous doorbell services
    let oldDoorbellService = accessory.getService(hap.Service.Doorbell);
    while (oldDoorbellService) {
      accessory.removeService(oldDoorbellService);
      oldDoorbellService = accessory.getService(hap.Service.Doorbell);
    }

    // Doorbell configuration
    this.createDoorbellService(
      'Doorbell',
      camera.info.capabilities.includes('indoor_chime') && this.options.doorbellAlerts,
      accessory,
      camera,
    );

    // Add doorbell switch
    doorbellSwitch && accessory.removeService(doorbellSwitch);
    if (
      camera.info.capabilities.includes('indoor_chime') &&
      this.options.doorbellAlerts &&
      this.options.doorbellSwitch
    ) {
      accessory
        .addService(hap.Service.StatelessProgrammableSwitch, 'DoorbellSwitch')
        .getCharacteristic(hap.Characteristic.ProgrammableSwitchEvent)
        .setProps({
          maxValue: hap.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
        });
    }

    // Streaming configuration
    this.createSwitchService(
      'Streaming',
      camera.info.capabilities.includes('streaming.start-stop') && this.options.streamingSwitch,
      accessory,
      camera,
      'streaming.enabled',
      async (value) => {
        await camera.toggleActive(value as boolean);
      },
    );

    // Chime configuration
    this.createSwitchService(
      'Chime',
      camera.info.capabilities.includes('indoor_chime') && this.options.chimeSwitch,
      accessory,
      camera,
      'doorbell.indoor_chime.enabled',
      async (value) => {
        await camera.toggleChime(value as boolean);
      },
    );

    // Audio switch configuration
    this.createSwitchService(
      'Audio',
      camera.info.capabilities.includes('audio.microphone') && this.options.audioSwitch,
      accessory,
      camera,
      'audio.enabled',
      async (value) => {
        await camera.toggleAudio(value as boolean);
      },
    );

    this.cameras.push(camera);
    this.accessories.push(accessory);
  }

  private async setupMotionServices(): Promise<void> {
    this.cameras.forEach(async (camera) => {
      const uuid = hap.uuid.generate(camera.info.uuid);
      const accessory = this.accessories.find((x: PlatformAccessory) => x.UUID === uuid);
      // Motion configuration
      const alertTypes = camera.getAlertTypes();
      const useFaces = alertTypes.includes('Face');
      const index = alertTypes.indexOf('Face');
      if (index > -1) {
        alertTypes.splice(index, 1);
      }
      if (useFaces) {
        const structureId = camera.info.nest_structure_id.replace('structure.', '');
        let structure = this.nestStructures[structureId];
        if (!structure) {
          this.log.debug(`Creating new structure: ${structureId}`);
          structure = new NestStructure(camera.info, this.config, this.log);
          this.nestStructures[structureId] = structure;
        }
        const faces = await structure.getFaces();
        if (faces) {
          faces.forEach((face: Face) => {
            this.log.debug(`Found face ${face.name} for ${structureId}`);
            alertTypes.push(`Face - ${face.name}`);
          });
        }
      }

      alertTypes.forEach((type) => {
        this.createMotionService(
          type,
          camera.info.capabilities.includes('detectors.on_camera') && this.options.motionDetection,
          accessory,
          camera,
        );
      });
    });
  }

  /**
   * Get info on all cameras
   */
  private async getCameras(): Promise<Array<CameraInfo>> {
    let cameras: Array<CameraInfo> = [];
    try {
      const response = await this.endpoints.sendRequest(
        this.config.access_token,
        this.endpoints.CAMERA_API_HOSTNAME,
        '/api/cameras.get_owned_and_member_of_with_properties',
        'GET',
      );
      cameras = response.items;
      if (this.structures.length > 0) {
        this.log.debug('Filtering cameras by structures');
        cameras = cameras.filter((info: CameraInfo) => this.structures.includes(info.nest_structure_name));
      }
    } catch (error) {
      handleError(this.log, error, 'Error fetching cameras');
    }
    return cameras;
  }

  /**
   * Add fetched cameras from nest to Homebridge
   */
  async addCameras(): Promise<void> {
    const cameras = await this.getCameras();
    cameras.forEach((cameraInfo: CameraInfo) => {
      const uuid = hap.uuid.generate(cameraInfo.uuid);
      const accessory = new Accessory(cameraInfo.name, uuid);
      cameraInfo.homebridge_uuid = uuid;
      accessory.context.cameraInfo = cameraInfo;

      const model = cameraInfo.type < ModelTypes.length ? ModelTypes[cameraInfo.type] : 'Unknown';
      const accessoryInformation = accessory.getService(hap.Service.AccessoryInformation);
      if (accessoryInformation) {
        accessoryInformation.setCharacteristic(hap.Characteristic.Manufacturer, 'Nest');
        accessoryInformation.setCharacteristic(hap.Characteristic.Model, model);
        accessoryInformation.setCharacteristic(hap.Characteristic.SerialNumber, cameraInfo.serial_number);
        accessoryInformation.setCharacteristic(
          hap.Characteristic.FirmwareRevision,
          cameraInfo.combined_software_version,
        );
      }

      // Only add new cameras that are not cached
      if (!this.accessories.find((x: PlatformAccessory) => x.UUID === uuid)) {
        this.log.debug(`New camera found: ${cameraInfo.name}`);
        this.configureAccessory(accessory); // abusing the configureAccessory here
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    });

    // Remove cameras that were not in previous call
    // this.accessories.forEach((accessory: PlatformAccessory) => {
    //   if (!cameras.find((x: CameraInfo) => x.uuid === accessory.context.cameraInfo.uuid)) {
    //     accessory.context.removed = true;
    //     this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    //     const index = this.accessories.indexOf(accessory);
    //     if (index > -1) {
    //       this.accessories.splice(index, 1);
    //       this.cameras.slice(index, 1);
    //     }
    //   }
    // });
  }

  async didFinishLaunching(): Promise<void> {
    const self = this;
    const connected = await this.setupConnection();

    if (connected) {
      // Nest needs to be reauthenticated about every hour
      setInterval(async function () {
        self.log.debug('Reauthenticating with config credentials');
        await self.setupConnection();
      }, 3480000); // 58 minutes

      const fieldTest = this.config.googleAuth.issueToken.includes('home.ft.nest.com');
      this.endpoints = new NestEndpoints(fieldTest);
      await this.addCameras();
      await this.setupMotionServices();
    }
  }
}

export = (api: API): void => {
  hap = api.hap;
  Accessory = api.platformAccessory;

  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, NestCamPlatform);
};
