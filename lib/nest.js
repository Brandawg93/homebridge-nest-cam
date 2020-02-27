'use strict';

const https = require('https');
const axios = require('axios');
const EventEmitter = require('events');
const NestCam = require('./nestcam').NestCam;
const NestEndpoints = require('./nest-endpoints.js');

const setupHeaders = function(method, accessToken) {
  let headers = {
    'User-Agent': NestEndpoints.USER_AGENT_STRING,
    'Referer': NestEndpoints.NEST_API_HOSTNAME
  };

  if (method === 'POST') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=utf-8';
  }

  if (accessToken !== void 0) {
    headers['Cookie'] = 'user_token=' + accessToken;
  }
  return headers;
};

class NestAPI extends EventEmitter {
  constructor(accessToken, config, log) {
    super();
    let self = this;
    NestEndpoints.init(config.options.fieldTest);
    self.fieldTest = config.options.fieldTest;
    self.accessToken = accessToken;
    self.log = log;
  }

  /**
   * Fetch cameras from nest and add them to Homebridge
   */
  async fetchCameras() {
    let self = this;
    try {
      let response = await self.sendRequest(NestEndpoints.CAMERA_API_HOSTNAME, '/api/cameras.get_owned_and_member_of_with_properties', 'GET');
      var cameras = [];
      response.items.forEach((cameraInfo) => {
        let camera = new NestCam(self, cameraInfo, self.log);
        cameras.push(camera);
      });
      self.emit('cameras', cameras);
    } catch(error) {
      error.status = error.response && error.response.status;
      self.log.error('Error fetching cameras - ' + error.status);
    }
  }

  /**
   * Send a generic api request
   * @param hostname  The base uri to send the request
   * @param endpoint  The endpoint to send the request
   * @param method    Usually 'GET' or 'POST'
   * @param body      The body of the request or null if a 'GET'
   */
  async sendRequest(hostname, endpoint, method, data) {
    let self = this;
    let headers = setupHeaders(method, self.accessToken);
    let url = hostname + endpoint;
    let req = {
      method,
      url,
      data,
      headers
    };
    self.log.debug(req.method + ' request sent to ' + req.url);
    return (await axios(req)).data;
  }

  /**
   * Send a generic api request using promises
   * @param hostname  The base uri to send the request
   * @param endpoint  The endpoint to send the request
   * @param method    Usually 'GET' or 'POST'
   * @param body      The body of the request or null if a 'GET'
   */
  sendPromiseRequest(hostname, path, method, body) {
    let self = this;
    return new Promise((resolve, reject) => {
      let headers = setupHeaders(method, self.accessToken);
      let options = {
        hostname,
        path,
        method,
        headers
      };
      let req = https.request(options, (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          let error = new Error('Unexpected API Error - ' + res.statusCode);
          error.code = res.statusCode;
          reject(error);
        }

        const resBody = [];
        res.on('data', (chunk) => resBody.push(chunk));
        res.on('end', () => resolve(Buffer.concat(resBody)));
      });
      req.on('error', (err) => reject(err));
      if (body !== void 0) {
        req.write(body);
      }
      req.end();
    });
  }
}

module.exports = {
  NestAPI
};
