import {
  API,
  APIEvent,
  AudioStreamingCodecType,
  AudioStreamingSamplerate,
  CameraControllerOptions,
  CharacteristicEventTypes,
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
import { CameraInfo, ModelTypes, Properties } from './camera-info';
import { NestEndpoints, handleError } from './nest-endpoints';
import { StreamingDelegate } from './streaming-delegate';
import { Connection } from './nest-connection';

let hap: HAP;
let Accessory: typeof PlatformAccessory;

const PLUGIN_NAME = 'homebridge-nest-cam';
const PLATFORM_NAME = 'Nest-cam';

class NestCamPlatform implements DynamicPlatformPlugin {
  private readonly log: Logging;
  private readonly api: API;
  private config: PlatformConfig;
  private endpoints: NestEndpoints = new NestEndpoints(false);
  private readonly accessories: Array<PlatformAccessory> = [];
  private readonly cameras: Array<NestCam> = [];
  private motionDetection = true;
  private doorbellAlerts = true;
  private doorbellSwitch = true;
  private streamingSwitch = true;
  private chimeSwitch = true;
  private audioSwitch = true;
  private structures: Array<string> = [];
  private alertTypes: Array<string> = ['Motion', 'Sound', 'Person', 'Package Delivered', 'Package Retrieved', 'face'];

  constructor(log: Logging, config: PlatformConfig, api: API) {
    this.log = log;
    this.api = api;
    this.config = config;

    // Need a config or plugin will not start
    if (!config) {
      return;
    }

    // Set up the config if options are not set
    const options = config.options;
    const motionDetection = options?.motionDetection;
    if (typeof motionDetection !== 'undefined') {
      this.motionDetection = motionDetection;
    }
    const doorbellAlerts = options?.doorbellAlerts;
    if (typeof doorbellAlerts !== 'undefined') {
      this.doorbellAlerts = doorbellAlerts;
    }
    const doorbellSwitch = options?.doorbellSwitch;
    if (typeof doorbellSwitch !== 'undefined') {
      this.doorbellSwitch = doorbellSwitch;
    }
    const streamingSwitch = options?.streamingSwitch;
    if (typeof streamingSwitch !== 'undefined') {
      this.streamingSwitch = streamingSwitch;
    }
    const chimeSwitch = options?.chimeSwitch;
    if (typeof chimeSwitch !== 'undefined') {
      this.chimeSwitch = chimeSwitch;
    }
    const audioSwitch = options?.audioSwitch;
    if (typeof audioSwitch !== 'undefined') {
      this.audioSwitch = audioSwitch;
    }
    const structures = options?.structures;
    if (typeof structures !== 'undefined') {
      this.structures = structures;
    }
    const alertTypes = options?.alertTypes;
    if (typeof alertTypes !== 'undefined') {
      this.alertTypes = alertTypes;
    }

    api.on(APIEvent.DID_FINISH_LAUNCHING, this.didFinishLaunching.bind(this));
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
  ) {
    const service = accessory.getService(`${accessory.displayName} ${name}`);
    if (service) {
      accessory.removeService(service);
    }
    if (canCreate) {
      accessory
        .addService(new hap.Service.Switch(`${accessory.displayName} ${name}`, `${accessory.displayName} ${name}`))
        .setCharacteristic(hap.Characteristic.On, camera.info.properties[_key])
        .getCharacteristic(hap.Characteristic.On)
        .on(CharacteristicEventTypes.SET, async (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
          cb(value);
          this.log.info(`Setting ${accessory.displayName} to ${value ? 'on' : 'off'}`);
          callback();
        });
    }
  }

  private updateSwitchService(name: string, accessory: PlatformAccessory, camera: NestCam, _key: keyof Properties) {
    const service = accessory.getService(name);
    service && service.updateCharacteristic(hap.Characteristic.On, camera.info.properties[_key]);
  }

  private createMotionService(name: string, canCreate: boolean, accessory: PlatformAccessory, camera: NestCam) {
    const service = accessory.getService(`${accessory.displayName} ${name}`);
    if (service) {
      accessory.removeService(service);
    }
    if (canCreate) {
      accessory.addService(
        new hap.Service.MotionSensor(`${accessory.displayName} ${name}`, `${accessory.displayName} ${name}`),
      );
      camera.startAlertChecks();
    }
  }

  private createDoorbellService(name: string, canCreate: boolean, accessory: PlatformAccessory, camera: NestCam) {
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
    const camera = new NestCam(this.config, cameraInfo, accessory, this.alertTypes, this.log, hap);
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
      camera.info.capabilities.includes('indoor_chime') && this.doorbellAlerts,
      accessory,
      camera,
    );

    // Add doorbell switch
    doorbellSwitch && accessory.removeService(doorbellSwitch);
    if (camera.info.capabilities.includes('indoor_chime') && this.doorbellAlerts && this.doorbellSwitch) {
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
      camera.info.capabilities.includes('streaming.start-stop') && this.streamingSwitch,
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
      camera.info.capabilities.includes('indoor_chime') && this.chimeSwitch,
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
      camera.info.capabilities.includes('audio.microphone') && this.audioSwitch,
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
      if (accessory) {
        // Motion configuration
        if (camera.info.full_camera_enabled) {
          if (camera.info.capabilities.includes('stranger_detection')) {
            const useFaces = camera.alertTypes.includes('face');
            const index = camera.alertTypes.indexOf('face');
            if (index > -1) {
              camera.alertTypes.splice(index, 1);
            }
            if (useFaces) {
              const faces = await camera.getFaces();
              if (faces) {
                faces.forEach((face: any) => {
                  camera.alertTypes.push(`Face - ${face.name}`);
                });
              }
            }
          } else {
            camera.alertTypes = ['Motion', 'Sound', 'Person'];
          }
          camera.alertTypes.forEach((type) => {
            this.createMotionService(
              type,
              camera.info.capabilities.includes('detectors.on_camera') && this.motionDetection,
              accessory,
              camera,
            );
          });
        } else {
          this.createMotionService(
            'Motion',
            camera.info.capabilities.includes('detectors.on_camera') && this.motionDetection,
            accessory,
            camera,
          );
        }
      }
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

  async updateCameras(): Promise<void> {
    const cameras = await this.getCameras();
    cameras.forEach((info: CameraInfo) => {
      const camera = this.cameras.find((x: NestCam) => x.info.uuid === info.uuid);
      const uuid = hap.uuid.generate(info.uuid);
      const accessory = this.accessories.find((x: PlatformAccessory) => x.UUID === uuid);
      if (camera && accessory) {
        this.log.debug(`Updating info for ${info.name}`);
        camera.info = info;
        camera.info.homebridge_uuid = uuid;
        // Update streaming
        this.updateSwitchService('Streaming', accessory, camera, 'streaming.enabled');

        // Update Chime
        this.updateSwitchService('Chime', accessory, camera, 'doorbell.indoor_chime.enabled');

        // Audio switch configuration
        this.updateSwitchService('Audio', accessory, camera, 'audio.enabled');
      }
    });
  }

  async didFinishLaunching(): Promise<void> {
    const self = this;
    const connected = await this.setupConnection();

    if (connected) {
      // Nest needs to be reauthenticated about every hour
      setInterval(async function () {
        await self.setupConnection();
      }, 3480000); // 58 minutes

      const fieldTest = this.config.googleAuth.issueToken.includes('home.ft.nest.com');
      this.endpoints = new NestEndpoints(fieldTest);
      await this.addCameras();
      await this.setupMotionServices();
      await this.updateCameras();
      // Camera info needs to be updated every minute
      setInterval(async function () {
        await self.updateCameras();
      }, 60000);
    }
  }
}

export = (api: API): void => {
  hap = api.hap;
  Accessory = api.platformAccessory;

  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, NestCamPlatform);
};
