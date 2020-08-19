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
  Service,
  WithUUID,
} from 'homebridge';
import { NestCam } from './nest-cam';
import { CameraInfo, ModelTypes, Properties } from './models/camera-info';
import { NestEndpoints, handleError } from './nest-endpoints';
import { StreamingDelegate } from './streaming-delegate';
import { Connection } from './nest-connection';
import { ConfigSchema, Schema } from './config-schema';

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
type ServiceType = WithUUID<typeof Service>;

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
  private structures: Array<string> = [];
  private schema: Schema = { structures: [] };

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

    if (this.config.googleAuth && (!this.config.googleAuth.issueToken || !this.config.googleAuth.cookies)) {
      this.log.error('You must provide issueToken and cookies in config.json. Please see README.md for instructions');
      return false;
    }

    this.config.fieldTest = this.config.googleAuth.issueToken.includes('home.ft.nest.com');
    this.log.debug(`Setting Field Test to ${this.config.fieldTest}`);
    const conn = new Connection(this.config, this.log);
    return await conn.auth();
  }

  private createService(accessory: PlatformAccessory, serviceType: ServiceType, name?: string): Service {
    const existingService = name
      ? accessory.getServiceById(serviceType, `${accessory.displayName} ${name}`)
      : accessory.getService(serviceType);

    const service =
      existingService ||
      (name
        ? accessory.addService(serviceType, `${accessory.displayName} ${name}`, `${accessory.displayName} ${name}`)
        : accessory.addService(serviceType, accessory.displayName));
    return service;
  }

  private createSwitchService(
    name: string,
    accessory: PlatformAccessory,
    serviceType: ServiceType,
    camera: NestCam,
    _key: keyof Properties,
    cb: (value: CharacteristicValue) => void,
  ): void {
    const service = this.createService(accessory, serviceType, name);
    this.log.debug(`Creating switch for ${accessory.displayName} ${name}.`);
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

    // Microphone configuration
    if (camera.info.capabilities.includes('audio.microphone')) {
      this.createService(accessory, hap.Service.Microphone);
      this.log.debug(`Creating microphone for ${accessory.displayName}.`);
    }

    if (camera.info.capabilities.includes('audio.microphone')) {
      this.createService(accessory, hap.Service.Speaker);
      this.log.debug(`Creating speaker for ${accessory.displayName}.`);
    }

    // Doorbell configuration
    if (camera.info.capabilities.includes('indoor_chime') && this.options.doorbellAlerts) {
      this.createService(accessory, hap.Service.Doorbell, 'Doorbell');
      this.log.debug(`Creating doorbell sensor for ${accessory.displayName}.`);
      camera.startAlertChecks();
    }

    // Add doorbell switch
    if (
      camera.info.capabilities.includes('indoor_chime') &&
      this.options.doorbellAlerts &&
      this.options.doorbellSwitch
    ) {
      const service = this.createService(accessory, hap.Service.StatelessProgrammableSwitch, 'DoorbellSwitch');
      this.log.debug(`Creating doorbell switch for ${accessory.displayName}.`);
      service.getCharacteristic(hap.Characteristic.ProgrammableSwitchEvent).setProps({
        maxValue: hap.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
      });
    }

    // Streaming switch configuration
    if (camera.info.capabilities.includes('streaming.start-stop') && this.options.streamingSwitch) {
      this.createSwitchService(
        'Streaming',
        accessory,
        hap.Service.Switch,
        camera,
        'streaming.enabled',
        async (value) => {
          await camera.toggleActive(value as boolean);
        },
      );
    }

    // Chime switch configuration
    if (camera.info.capabilities.includes('indoor_chime') && this.options.chimeSwitch) {
      this.createSwitchService(
        'Chime',
        accessory,
        hap.Service.Switch,
        camera,
        'doorbell.indoor_chime.enabled',
        async (value) => {
          await camera.toggleChime(value as boolean);
        },
      );
    }

    // Audio switch configuration
    if (camera.info.capabilities.includes('audio.microphone') && this.options.audioSwitch) {
      this.createSwitchService('Audio', accessory, hap.Service.Switch, camera, 'audio.enabled', async (value) => {
        await camera.toggleAudio(value as boolean);
      });
    }

    this.cameras.push(camera);
    this.accessories.push(accessory);
  }

  private async setupMotionServices(): Promise<void> {
    this.cameras.forEach(async (camera) => {
      const uuid = hap.uuid.generate(camera.info.uuid);
      const accessory = this.accessories.find((x: PlatformAccessory) => x.UUID === uuid);
      if (accessory) {
        // Motion configuration
        const alertTypes = await camera.getAlertTypes();
        alertTypes.forEach((type) => {
          if (camera.info.capabilities.includes('detectors.on_camera') && this.options.motionDetection) {
            this.createService(accessory, hap.Service.MotionSensor, type);
            this.log.debug(`Creating motion sensor for ${accessory.displayName} ${type}.`);
            camera.startAlertChecks();
          }
        });
      }
    });
  }

  private removeAccessory(accessory: PlatformAccessory): void {
    accessory.context.removed = true;
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    const index = this.accessories.indexOf(accessory);
    if (index > -1) {
      this.accessories.splice(index, 1);
      this.cameras.slice(index, 1);
    }
  }

  private cleanupAccessories(): void {
    //Remove cached cameras filtered by structure
    if (this.structures.length > 0) {
      const oldCameras = this.cameras.filter(
        (camera: NestCam) => !this.structures.includes(camera.info.nest_structure_id.replace('structure.', '')),
      );
      oldCameras.forEach((camera) => {
        const uuid = hap.uuid.generate(camera.info.uuid);
        const accessory = this.accessories.find((x: PlatformAccessory) => x.UUID === uuid);
        if (accessory) {
          this.removeAccessory(accessory);
        }
      });
    }

    // Remove cameras that were not in previous call
    // this.accessories.forEach((accessory: PlatformAccessory) => {
    //   if (!cameras.find((x: CameraInfo) => x.uuid === accessory.context.cameraInfo.uuid)) {
    //     this.removeAccessory(accessory);
    //   }
    // });
  }

  private async generateConfigSchema(): Promise<void> {
    const schema = new ConfigSchema(this.schema, this.api.user.storagePath(), this.log);
    await schema.generate();
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

      cameras.forEach((cameraInfo) => {
        const exists = this.schema.structures.find(
          (x) => x.id == cameraInfo.nest_structure_id.replace('structure.', ''),
        );
        if (!exists) {
          this.schema.structures.push({
            name: cameraInfo.nest_structure_name,
            id: cameraInfo.nest_structure_id.replace('structure.', ''),
          });
        }
      });

      if (this.structures.length > 0) {
        this.log.debug('Filtering cameras by structures');
        cameras = cameras.filter((info: CameraInfo) =>
          this.structures.includes(info.nest_structure_id.replace('structure.', '')),
        );
      }
    } catch (error) {
      handleError(this.log, error, 'Error fetching cameras');
    }
    return cameras;
  }

  /**
   * Add fetched cameras from nest to Homebridge
   */
  private async addCameras(): Promise<void> {
    const cameras = await this.getCameras();
    cameras.forEach((cameraInfo: CameraInfo) => {
      const uuid = hap.uuid.generate(cameraInfo.uuid);
      const displayName = cameraInfo.name.replace('(', '').replace(')', '');
      const accessory = new Accessory(displayName, uuid);
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
      await this.generateConfigSchema();
      this.cleanupAccessories();
    }
  }
}

export = (api: API): void => {
  hap = api.hap;
  Accessory = api.platformAccessory;

  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, NestCamPlatform);
};
