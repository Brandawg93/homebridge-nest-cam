'use strict';

let Accessory, Service, Characteristic, hap, UUIDGen;
const Nest = require('./lib/nest.js').NestAPI;
const NestConnection = require('./lib/nest-connection.js');

const UPDATE_INTERVAL = 10000;

Promise.delay = function(time_ms) {
  return new Promise((resolve) => setTimeout(resolve, time_ms));
};

const modelTypes = {
  8: 'Nest Cam Indoor',
  9: 'Nest Cam Outdoor',
  10: 'Nest Cam IQ Indoor',
  11: 'Nest Cam IQ Outdoor',
  12: 'Nest Hello'
};

const setupConnection = async function(config, log) {
  if (!config.googleAuth) {
    log.error('You did not specify your Google account credentials, googleAuth, in config.json');
    return;
  }

  if (config.googleAuth && (!config.googleAuth.issueToken || !config.googleAuth.cookies || !config.googleAuth.apiKey)) {
    log.error('You must provide issueToken, cookies and apiKey in config.json. Please see README.md for instructions');
    return;
  }

  config.options.fieldTest = config.googleAuth.issueToken.includes('home.ft.nest.com');
  log.debug('Setting Field Test to %s', config.options.fieldTest);
  const conn = new NestConnection(config, log);
  try {
    let connected = await conn.auth();
    return connected;
  } catch(error) {
    throw('Unable to connect to Nest service.', error);
  }
};

class NestCamPlatform {
  constructor(log, config, api) {
    let self = this;
    self.log = log;
    self.config = config || {};
    if (api) {
      self.api = api;
      if (api.version < 2.1) {
        throw new Error('Unexpected API version.');
      }

      self.api.on('didFinishLaunching', self.didFinishLaunching.bind(this));
    }
  }

  configureAccessory(accessory) {
    // Won't be invoked
  }

  /**
   * Add fetched cameras from nest to Homebridge
   * @param accessToken The google access token
   */
  async addCameras(accessToken) {
    let self = this;
    self.nestAPI = new Nest(accessToken, self.config, self.log);

    // Nest needs to be reauthenticated about every hour
    setInterval(async function() {
      let connected = await setupConnection(self.config, self.log);
      if (connected) {
        self.nestAPI.accessToken = self.config.access_token;
      }
    }, 3600000);

    self.nestAPI.on('cameras', (cameras) => {
      let configuredAccessories = [];
      cameras.forEach((camera) => {
        camera.configureWithHAP(hap, self.config);
        let name = camera.name;
        let model = (modelTypes.hasOwnProperty(camera.type)) ? modelTypes[camera.type] : 'Unknown';
        let uuid = UUIDGen.generate(camera.uuid);
        let accessory = new Accessory(name, uuid, hap.Accessory.Categories.CAMERA);
        let accessoryInformation = accessory.getService(Service.AccessoryInformation);
        accessoryInformation.setCharacteristic(Characteristic.Manufacturer, 'Nest');
        accessoryInformation.setCharacteristic(Characteristic.Model, model);
        accessoryInformation.setCharacteristic(Characteristic.SerialNumber, camera.serialNumber);
        accessoryInformation.setCharacteristic(Characteristic.FirmwareRevision, camera.softwareVersion);
        self.log.info('Create camera - ' + name);
        //Add motion detection
        if (camera.detectors.includes('motion')) {
          var motion = new Service.MotionSensor(name);
          accessory.addService(motion);
          setInterval(async function() {
            camera.checkMotion(accessory);
          }, UPDATE_INTERVAL);
        }
        //Add enabled/disabled service
        accessory.addService(Service.Switch, 'Streaming')
          .setCharacteristic(Characteristic.On, camera.enabled)
          .getCharacteristic(Characteristic.On)
          .on('set', async function(value, callback) {
            await camera.toggleActive(value);
            self.log.info('Setting %s to %s', accessory.displayName, (value ? 'on' : 'off'));
            callback();
          });
        //Check enabled/disabled state
        setInterval(async function() {
          await camera.updateInfo();
          let service = accessory.getService(Service.Switch);
          service.updateCharacteristic(Characteristic.On, camera.enabled);
        }, UPDATE_INTERVAL);

        accessory.configureCameraSource(camera);
        configuredAccessories.push(accessory);
      });
      self.api.publishCameraAccessories('Nest-cam', configuredAccessories);
    });
    await self.nestAPI.fetchCameras();
  }

  async didFinishLaunching() {
    let self = this;
    let googleAuth = self.config['googleAuth'];
    let options = self.config['options'];
    if (typeof googleAuth === 'undefined')
    {
      throw new Error('googleAuth is not defined in the Homebridge config');
    }
    if (typeof options === 'undefined')
    {
      self.config.options = {};
    }
    let connected = await setupConnection(self.config, self.log);
    if (connected) {
      await self.addCameras(self.config.access_token);
    }
  }
}

module.exports = (homebridge) => {
  Accessory = homebridge.platformAccessory;
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  hap = homebridge.hap;
  UUIDGen = homebridge.hap.uuid;

  homebridge.registerPlatform('homebridge-nest-cam', 'Nest-cam', NestCamPlatform, true);
};
