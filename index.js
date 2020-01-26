'use strict';

let Accessory, Service, Characteristic, hap, UUIDGen;
const Nest = require('./lib/nest.js').NestAPI;
const NestConnection = require('./lib/nest-connection.js');
const Promise = require('bluebird');
const modelTypes = {
  8: 'Nest Cam Indoor',
  9: 'Nest Cam Outdoor',
  10: 'Nest Cam IQ Indoor',
  11: 'Nest Cam IQ Outdoor',
  12: 'Nest Hello'
}

module.exports = (homebridge) => {
  Accessory = homebridge.platformAccessory;
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  hap = homebridge.hap;
  UUIDGen = homebridge.hap.uuid;

  homebridge.registerPlatform('homebridge-nest-cam', 'Nest-cam', NestCamPlatform, true);
}

const setupConnection = function(config, log) {
  return new Promise(function (resolve, reject) {
    if (!config.access_token && !config.googleAuth && (!config.email || !config.password)) {
      reject('You did not specify your Nest account credentials {\'email\',\'password\'}, or an access_token, or googleAuth, in config.json');
        return;
    }

    if (config.googleAuth && (!config.googleAuth.issueToken || !config.googleAuth.cookies || !config.googleAuth.apiKey)) {
      reject('When using googleAuth, you must provide issueToken, cookies and apiKey in config.json. Please see README.md for instructions');
      return;
    }

    const conn = new NestConnection(config, log);
    conn.auth().then(connected => {
      if (connected) {
        resolve(conn);
      } else {
        reject('Unable to connect to Nest service.');
      }
    });
  });
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
  addCameras(accessToken) {
    let self = this;
    self.nestAPI = new Nest(accessToken, self.config, self.log);
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
        // WIP
        // if (camera.detectors.includes('motion')) {
        //   var motion = new Service.MotionSensor(name);
        //   accessory.addService(motion);
        //   setInterval(camera.checkMotion, 10000, accessory, self.log);
        // }
        accessory.configureCameraSource(camera);
        configuredAccessories.push(accessory);
      });
      self.api.publishCameraAccessories('Nest-cam', configuredAccessories);
    });
    self.nestAPI.fetchCameras();
  }

  didFinishLaunching() {
    let self = this;
    let googleAuth = self.config['googleAuth'];
    if ( typeof googleAuth == 'undefined')
    {
      throw new Error('googleAuth is not defined in the Homebridge config');
    }
    setupConnection(self.config, self.log)
        .then(function(conn){
            return;
        })
        .then(function(data) {
            self.addCameras(self.config.access_token);
        })
        .catch(function(err) {
            self.log.error(err);
            if (callback) {
                callback([]);
            }
        });
  }
}
