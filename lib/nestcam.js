'use strict';

let uuid, Service, Characteristic, StreamController;

const spawn = require('child_process').spawn;
const querystring = require('querystring');
const NexusStreamer = require('./streamer').NexusStreamer;
const ModelTypes = require('./protos/ModelTypes.js').ModelTypes;
const NestAPIHostname = 'https://webapi.camera.home.nest.com';

class NestCam {
  constructor(api, info, log) {
    let self = this;
    self.ffmpegCodec = "libx264";
    self.api = api;
    self.log = log;
    self.name = info.name;
    self.uuid = info.uuid;
    self.enabled = info.is_streaming_enabled;
    self.serialNumber = info.serial_number;
    self.softwareVersion = info.combined_software_version;
    self.detectors = info.detectors;
    self.type = info.type;
    self.nexusTalkHost = info.direct_nexustalk_host;
    self.apiHost = info.nexus_api_http_server;
    self.motionDetected = false;
  }

  async updateInfo() {
    let self = this;
    let query = querystring.stringify({
      'uuid': self.uuid
    });
    try {
      self.log.debug("Updating info for %s", self.name);
      let response = await self.api.sendRequest(NestAPIHostname, '/api/cameras.get_with_properties?' + query, 'GET');
      response.items.forEach((info) => {
        self.name = info.name;
        self.uuid = info.uuid;
        self.enabled = info.is_streaming_enabled;
        self.serialNumber = info.serial_number;
        self.softwareVersion = info.combined_software_version;
        self.detectors = info.detectors;
        self.type = info.type;
        self.nexusTalkHost = info.direct_nexustalk_host;
        self.apiHost = info.nexus_api_http_server;
      });
    } catch(error) {
      error.status = error.response && error.response.status;
      self.log.error('Error fetching cameras - ' + error.status);
    }
  }

  async toggleActive(enabled) {
    let self = this;
    let query = querystring.stringify({
      'streaming.enabled': enabled,
      'uuid': self.uuid
    });
    try {
      let response = await self.api.sendRequest(NestAPIHostname, '/api/dropcams.set_properties', 'POST', query);
      self.enabled = enabled;
    } catch(error) {
      error.status = error.response && error.response.status;
      self.log.error('Error toggling camera state - ' + error.status);
    }
  }

  async checkMotion(accessory) {
    let self = this;
    self.log.debug("Checking for motion on %s", accessory.displayName);
    try {
      let currDate = new Date();
      currDate.setMinutes(currDate.getMinutes() - 1);
      const epoch = Math.floor(currDate / 1000);
      let query = querystring.stringify({
        'start_time': epoch
      });
      let response = await self.api.sendRequest(self.apiHost, '/cuepoint/' + self.uuid + '/2?' + query, 'GET');
      if (response.length > 0) {
        let trigger = response[0];
        if (trigger.is_important && !self.motionDetected) {
          self.setMotion(accessory, true);
        }
      } else if (self.motionDetected) {
        self.setMotion(accessory, false);
      }
    } catch(error) {
      error.status = error.response && error.response.status;
      self.log.error('Error checking motion - ' + error.status);
    }
  }

  setMotion(accessory, state) {
    let self = this;
    self.log.debug("Setting %s Motion to %s", accessory.displayName, state);
    let service = accessory.getService(Service.MotionSensor);
    service.updateCharacteristic(Characteristic.MotionDetected, state);
    self.motionDetected = state;
  }

  // Homebridge

  configureWithHAP(hap, config) {
    uuid = hap.uuid;
    Service = hap.Service;
    Characteristic = hap.Characteristic;
    StreamController = hap.StreamController;

    let self = this;
    if (config.ffmpegCodec) {
      self.ffmpegCodec = config.ffmpegCodec;
    }
    self.services = [];
    self.streamControllers = [];

    self.sessions = {};

    let numberOfStreams = 2;
    let videoResolutions;
    // Use 4:3 aspect ratio resolutions for Nest Hello cameras
    if (self.type == ModelTypes.NEST_HELLO) {
      videoResolutions = [
        [320, 240, 30],
        [480, 360, 30],
        [640, 480, 30],
        [1280, 960, 30],
        [1600, 1200, 30]
      ];
    // Use 16:9 aspect ratio resolutions for all other Nest Cameras
    } else {
      videoResolutions = [
        [320, 180, 30],
        [480, 270, 30],
        [640, 360, 30],
        [1280, 720, 30],
        [1920, 1080, 30]
      ];
    }

    let options = {
      proxy: false,
      srtp: true,
      video: {
        resolutions: videoResolutions,
        codec: {
          profiles: [0, 1, 2],
          levels: [0, 1, 2]
        }
      },
      audio: {
        codecs: [
          {
            type: "OPUS",
            samplerate: 24
          },
          {
            type: "OPUS",
            samplerate: 16
          },
          {
            type: "OPUS",
            samplerate: 8
          },
          {
            type: "AAC-eld",
            samplerate: 16
          }
        ]
      }
    }

    self.createCameraControlService();
    self._createStreamControllers(numberOfStreams, options);
  }

  // Camera Source

  handleSnapshotRequest(request, callback) {
    let self = this;
    let query = querystring.stringify({
      uuid: self.uuid,
      width: request.width
    });
    self.api.sendPromiseRequest(self.apiHost, '/get_image?' + query, 'GET')
      .then((response) => {
        callback(undefined, response);
      })
      .catch((err) => {
        callback(err);
      });
  }

  handleCloseConnection(connectionID) {
    let self = this;
    self.streamControllers.forEach((controller) => {
      controller.handleCloseConnection(connectionID);
    });
  }

  prepareStream(request, callback) {
    let self = this;

    if (self.enabled) {
      let sessionID = uuid.unparse(request["sessionID"]);
      let streamer = new NexusStreamer(self.nexusTalkHost, self.uuid, self.api.accessToken, self.ffmpegCodec, self.log);
      self.sessions[sessionID] = streamer;
      streamer.prepareStream(request, callback);
    }
  }

  handleStreamRequest(request) {
    let self = this;

    let sessionID = request["sessionID"];
    let requestType = request["type"];

    if (sessionID) {
      let sessionIdentifier = uuid.unparse(sessionID);
      let streamer = self.sessions[sessionIdentifier];
      if (!streamer) {
        return;
      }

      if (requestType === 'start') {
        streamer.startPlaybackWithRequest(request);
      } else if (requestType === 'stop') {
        streamer.stopPlayback();
        delete self.sessions[sessionIdentifier];
      }
    }
  }

  createCameraControlService() {
    let self = this;
    let controlService = new Service.CameraControl();
    self.services.push(controlService);
  }

  _createStreamControllers(maxStreams, options) {
    let self = this;
    for (var i = 0; i < maxStreams; i++) {
      var streamController = new StreamController(i, options, self);
      self.services.push(streamController.service);
      self.streamControllers.push(streamController);
    }
  }
}

module.exports = {
  NestCam: NestCam
};
