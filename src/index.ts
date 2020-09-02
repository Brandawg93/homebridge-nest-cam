import {
  API,
  APIEvent,
  DynamicPlatformPlugin,
  HAP,
  Logging,
  PlatformAccessory,
  PlatformAccessoryEvent,
  PlatformConfig,
} from 'homebridge';
import { NestCam } from './nest/cam';
import { CameraInfo, ModelTypes } from './nest/models/camera-info';
import { NestEndpoints, handleError } from './nest/endpoints';
import { Connection } from './nest/connection';
import { NestSession } from './nest/session';
import { NestAccessory } from './accessory';
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

    this.config.fieldTest = this.config.googleAuth.issueToken.endsWith('https%3A%2F%2Fhome.ft.nest.com');
    this.log.debug(`Setting Field Test to ${this.config.fieldTest}`);
    const conn = new Connection(this.config, this.log);
    return await conn.auth();
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info(`Configuring accessory ${accessory.displayName}`);

    accessory.on(PlatformAccessoryEvent.IDENTIFY, () => {
      this.log.info(`${accessory.displayName} identified!`);
    });

    const cameraInfo: CameraInfo = accessory.context.cameraInfo;
    const camera = new NestCam(this.config, cameraInfo, accessory, this.log, hap);
    const nestAccessory = new NestAccessory(accessory, this.config, this.log, hap);
    nestAccessory.configureController(camera);

    // Microphone configuration
    if (camera.info.capabilities.includes('audio.microphone')) {
      nestAccessory.createService(hap.Service.Microphone);
      this.log.debug(`Creating microphone for ${accessory.displayName}.`);
    }

    if (camera.info.capabilities.includes('audio.microphone')) {
      nestAccessory.createService(hap.Service.Speaker);
      this.log.debug(`Creating speaker for ${accessory.displayName}.`);
    }

    // Doorbell configuration
    if (camera.info.capabilities.includes('indoor_chime') && this.options.doorbellAlerts) {
      nestAccessory.createService(hap.Service.Doorbell, 'Doorbell');
      this.log.debug(`Creating doorbell sensor for ${accessory.displayName}.`);
      camera.startAlertChecks();
    }

    // Add doorbell switch
    if (
      camera.info.capabilities.includes('indoor_chime') &&
      this.options.doorbellAlerts &&
      this.options.doorbellSwitch
    ) {
      const service = nestAccessory.createService(hap.Service.StatelessProgrammableSwitch, 'DoorbellSwitch');
      this.log.debug(`Creating doorbell switch for ${accessory.displayName}.`);
      service.getCharacteristic(hap.Characteristic.ProgrammableSwitchEvent).setProps({
        maxValue: hap.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
      });
    }

    // Streaming switch configuration
    if (camera.info.capabilities.includes('streaming.start-stop') && this.options.streamingSwitch) {
      nestAccessory.createSwitchService('Streaming', hap.Service.Switch, camera, 'streaming.enabled', async (value) => {
        await camera.toggleActive(value as boolean);
      });
    }

    // Chime switch configuration
    if (camera.info.capabilities.includes('indoor_chime') && this.options.chimeSwitch) {
      nestAccessory.createSwitchService(
        'Chime',
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
      nestAccessory.createSwitchService('Audio', hap.Service.Switch, camera, 'audio.enabled', async (value) => {
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
        const nestAccessory = new NestAccessory(accessory, this.config, this.log, hap);
        const services = nestAccessory.getServicesByType(hap.Service.MotionSensor);
        const alertTypes = await camera.getAlertTypes();
        // Remove invalid services
        const invalidServices = services.filter((x) => !alertTypes.includes(x.displayName));
        for (const service of invalidServices) {
          accessory.removeService(service);
        }
        alertTypes.forEach((type) => {
          if (camera.info.capabilities.includes('detectors.on_camera') && this.options.motionDetection) {
            nestAccessory.createService(hap.Service.MotionSensor, type);
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

      const fieldTest = this.config.googleAuth.issueToken.endsWith('https%3A%2F%2Fhome.ft.nest.com');
      this.endpoints = new NestEndpoints(fieldTest);
      await this.addCameras();
      await this.setupMotionServices();
      await this.generateConfigSchema();
      this.cleanupAccessories();
      const session = new NestSession(this.config, this.log);
      await session.subscribe(this.cameras);
    }
  }
}

export = (api: API): void => {
  hap = api.hap;
  Accessory = api.platformAccessory;

  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, NestCamPlatform);
};
