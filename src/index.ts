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
import { CameraInfo } from './nest/types/camera';
import { NestConfig } from './nest/types/config';
import { auth, old_auth, nest_auth, getCameras } from './nest/connection';
import { NestSession } from './nest/session';
import { NestAccessory } from './accessory';

class Options {
  motionDetection = true;
  doorbellAlerts = true;
  doorbellSwitch = true;
  streamingSwitch = true;
  chimeSwitch = true;
  announcementsSwitch = true;
  audioSwitch = true;
}

interface NestObject {
  accessory: PlatformAccessory;
  camera: NestCam;
}

const ModelTypes = [
  'Nest Camera',
  'Nest Camera',
  'Nest Camera',
  'Nest Camera',
  'Nest Camera',
  'Nest Camera',
  'Nest Camera',
  'Nest Camera',
  'Nest Cam Indoor',
  'Nest Cam Outdoor',
  'Nest Cam IQ Indoor',
  'Nest Cam IQ Outdoor',
  'Nest Hello',
];

let hap: HAP;
let Accessory: typeof PlatformAccessory;

const PLUGIN_NAME = 'homebridge-nest-cam';
const PLATFORM_NAME = 'Nest-cam';

class NestCamPlatform implements DynamicPlatformPlugin {
  private readonly log: Logging;
  private readonly api: API;
  private config: NestConfig;
  private options: Options;
  private readonly nestObjects: Array<NestObject> = [];
  private structures: Array<string> = [];
  private cameras: Array<string> = [];

  constructor(log: Logging, config: PlatformConfig, api: API) {
    this.log = log;
    this.api = api;
    this.config = config as NestConfig;
    this.options = new Options();

    // Need a config or plugin will not start
    if (!config) {
      return;
    }

    this.initDefaultOptions();
    api.on(APIEvent.DID_FINISH_LAUNCHING, this.didFinishLaunching.bind(this));
    api.on(APIEvent.SHUTDOWN, this.isShuttingDown.bind(this));
  }

  private initDefaultOptions(): void {
    // Setup boolean options
    Object.keys(this.options).forEach((opt) => {
      const key = opt as keyof Options;
      if (this.config.options) {
        const configVal = this.config.options[key];
        if (typeof configVal === 'undefined') {
          this.options[key] = true;
          this.log.debug(`Defaulting ${key} to true`);
        } else {
          this.options[key] = configVal;
          this.log.debug(`Using ${key} from config: ${configVal}`);
        }
      }
    });

    const structures = this.config.options?.structures;
    if (typeof structures !== 'undefined') {
      this.log.debug(`Using structures from config: ${structures}`);
      this.structures = structures;
    } else {
      this.log.debug('Defaulting structures to []');
    }

    const cameras = this.config.options?.cameras;
    if (typeof cameras !== 'undefined') {
      this.log.debug(`Using cameras from config: ${cameras}`);
      this.cameras = cameras;
    } else {
      this.log.debug('Defaulting cameras to []');
    }
  }

  configureAccessory(accessory: PlatformAccessory<Record<string, CameraInfo>>): void {
    this.log.info(`Configuring accessory ${accessory.displayName}`);

    accessory.on(PlatformAccessoryEvent.IDENTIFY, () => {
      this.log.info(`${accessory.displayName} identified!`);
    });

    const cameraInfo = accessory.context.cameraInfo;
    const camera = new NestCam(this.config, cameraInfo, this.log);
    const nestAccessory = new NestAccessory(accessory, camera, this.config, this.log, hap);
    nestAccessory.configureController();

    // Microphone configuration
    if (camera.info.capabilities.includes('audio.microphone')) {
      nestAccessory.createService(hap.Service.Microphone);
      nestAccessory.createService(hap.Service.Speaker);
      this.log.debug(`Creating microphone for ${accessory.displayName}.`);
    }

    // Doorbell configuration
    if (camera.info.capabilities.includes('indoor_chime') && this.options.doorbellAlerts) {
      nestAccessory.createService(hap.Service.Doorbell, 'Doorbell');
      this.log.debug(`Creating doorbell sensor for ${accessory.displayName}.`);
      camera.startAlertChecks();
    } else {
      nestAccessory.removeService(hap.Service.Doorbell, 'Doorbell');
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
    } else {
      nestAccessory.removeService(hap.Service.StatelessProgrammableSwitch, 'DoorbellSwitch');
    }

    // Streaming switch configuration
    if (camera.info.capabilities.includes('streaming.start-stop') && this.options.streamingSwitch) {
      nestAccessory.createSwitchService('Streaming', hap.Service.Switch, 'streaming.enabled', async (value) => {
        await nestAccessory.toggleActive(value as boolean);
      });
    } else {
      nestAccessory.removeService(hap.Service.Switch, 'Streaming');
    }

    // Chime switch configuration
    if (camera.info.capabilities.includes('indoor_chime') && this.options.chimeSwitch) {
      nestAccessory.createSwitchService('Chime', hap.Service.Switch, 'doorbell.indoor_chime.enabled', async (value) => {
        await nestAccessory.toggleChime(value as boolean);
      });
    } else {
      nestAccessory.removeService(hap.Service.Switch, 'Chime');
    }

    // Announcements switch configuration
    if (camera.info.capabilities.includes('indoor_chime') && this.options.announcementsSwitch) {
      nestAccessory.createSwitchService(
        'Announcements',
        hap.Service.Switch,
        'doorbell.chime_assist.enabled',
        async (value) => {
          await nestAccessory.toggleAnnouncements(value as boolean);
        },
      );
    } else {
      nestAccessory.removeService(hap.Service.Switch, 'Announcements');
    }

    // Audio switch configuration
    if (camera.info.capabilities.includes('audio.microphone') && this.options.audioSwitch) {
      nestAccessory.createSwitchService('Audio', hap.Service.Switch, 'audio.enabled', async (value) => {
        await nestAccessory.toggleAudio(value as boolean);
      });
    } else {
      nestAccessory.removeService(hap.Service.Switch, 'Audio');
    }

    //Update Firmware Revision
    const accessoryInformation = accessory.getService(hap.Service.AccessoryInformation);
    if (accessoryInformation) {
      accessoryInformation.setCharacteristic(hap.Characteristic.FirmwareRevision, cameraInfo.combined_software_version);
    }

    this.nestObjects.push({ accessory: accessory, camera: camera });
  }

  private async setupMotionServices(): Promise<void> {
    this.nestObjects.forEach(async (obj) => {
      const camera = obj.camera;
      const accessory = obj.accessory;
      if (accessory) {
        const nestAccessory = new NestAccessory(accessory, camera, this.config, this.log, hap);
        if (this.options.motionDetection) {
          // Motion configuration
          const services = nestAccessory.getServicesByType(hap.Service.MotionSensor);
          const alertTypes = await camera.getAlertTypes();
          // Remove invalid services
          const invalidServices = services.filter((x) => !alertTypes.includes(x.displayName));
          for (const service of invalidServices) {
            accessory.removeService(service);
          }
          alertTypes.forEach((type) => {
            if (camera.info.capabilities.includes('detectors.on_camera')) {
              nestAccessory.createService(hap.Service.MotionSensor, type);
              this.log.debug(`Creating motion sensor for ${accessory.displayName} ${type}.`);
              camera.startAlertChecks();
            }
          });
        } else {
          nestAccessory.removeAllServicesByType(hap.Service.MotionSensor);
        }
      }
    });
  }

  private cleanupAccessories(): void {
    //Remove cached cameras filtered by structure
    if (this.structures.length > 0) {
      const oldObjects = this.nestObjects.filter(
        (obj: NestObject) => !this.structures.includes(obj.camera.info.nest_structure_id.replace('structure.', '')),
      );
      oldObjects.forEach((obj) => {
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [obj.accessory]);
        const index = this.nestObjects.indexOf(obj);
        if (index > -1) {
          obj.camera.stopAlertChecks();
          this.nestObjects.splice(index, 1);
        }
      });
    }
    if (this.cameras.length > 0) {
      const oldObjects = this.nestObjects.filter((obj: NestObject) => !this.cameras.includes(obj.camera.info.uuid));
      oldObjects.forEach((obj) => {
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [obj.accessory]);
        const index = this.nestObjects.indexOf(obj);
        if (index > -1) {
          obj.camera.stopAlertChecks();
          this.nestObjects.splice(index, 1);
        }
      });
    }
  }

  /**
   * Filter cameras from Nest account
   */
  private filterCameras(cameras: Array<CameraInfo>): Array<CameraInfo> {
    if (this.structures.length > 0) {
      this.log.debug('Filtering cameras by structures config');
      cameras = cameras.filter((info: CameraInfo) =>
        this.structures.includes(info.nest_structure_id.replace('structure.', '')),
      );
    }
    if (this.cameras.length > 0) {
      this.log.debug('Filtering cameras by cameras config');
      cameras = cameras.filter((info: CameraInfo) => this.cameras.includes(info.uuid));
    }
    return cameras;
  }

  /**
   * Add fetched cameras from nest to Homebridge
   */
  private async addCameras(cameras: Array<CameraInfo>): Promise<void> {
    const filteredCameras = await this.filterCameras(cameras);
    filteredCameras.forEach(async (cameraInfo: CameraInfo) => {
      const uuid = hap.uuid.generate(cameraInfo.uuid);
      // Parenthesis in the name breaks HomeKit for some reason
      const displayName = cameraInfo.name.replace('(', '').replace(')', '');
      const accessory = new Accessory(displayName, uuid);
      accessory.context.cameraInfo = cameraInfo;

      const model = cameraInfo.type < ModelTypes.length ? ModelTypes[cameraInfo.type] : 'Nest Camera';
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
      const obj = this.nestObjects.find((x: NestObject) => x.accessory.UUID === uuid);
      if (obj) {
        await obj.camera.updateData(cameraInfo);
      } else {
        this.log.debug(`New camera found: ${cameraInfo.name}`);
        this.configureAccessory(accessory); // abusing the configureAccessory here
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    });
  }

  async getAccessToken(): Promise<string> {
    const { refreshToken, googleAuth, nest_token } = this.config;

    if (refreshToken) {
      return await auth(refreshToken, this.config.options?.fieldTest, this.log);
    } else if (googleAuth) {
      const { apiKey, issueToken, cookies } = googleAuth;

      if (!issueToken || !cookies) {
        this.log.error('You must provide issueToken and cookies in config.json. Please see README.md for instructions');
        return '';
      }

      return await old_auth(issueToken, cookies, apiKey, this.log);
    } else if (nest_token) {
      return await nest_auth(nest_token, this.log)
    } else {
      this.log.error(
        'You must provide a refreshToken or googleAuth object in config.json. Please see README.md for instructions',
      );
      return '';
    }
  }

  async didFinishLaunching(): Promise<void> {
    const self = this;
    const accessToken = await this.getAccessToken();
    if (accessToken) {
      this.config.access_token = accessToken;
      // Nest needs to be reauthenticated about every hour
      setInterval(async () => {
        self.log.debug('Reauthenticating with config credentials');
        this.config.access_token = await this.getAccessToken();
      }, 3480000); // 58 minutes

      const cameras = await getCameras(this.config, this.log);
      await this.addCameras(cameras);
      await this.setupMotionServices();
      this.cleanupAccessories();
      const session = new NestSession(this.config, this.log);
      const cameraObjects = this.nestObjects.map((x) => x.camera);
      await session.subscribe(cameraObjects);
    } else {
      this.log.error('Unable to retrieve access token.');
    }
  }

  isShuttingDown(): void {
    const accessoryObjects = this.nestObjects.map((x) => x.accessory);
    this.api.updatePlatformAccessories(accessoryObjects);
  }
}

export = (api: API): void => {
  hap = api.hap;
  Accessory = api.platformAccessory;

  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, NestCamPlatform);
};
