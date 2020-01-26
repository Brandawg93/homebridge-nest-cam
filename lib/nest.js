'use strict';

const https = require('https');
const querystring = require('querystring');
const EventEmitter = require('events');
const NestCam = require('./nestcam').NestCam;
const NestConnection = require('./nest-connection.js');

const NestAPIHostname = 'webapi.camera.home.nest.com';
const NestAuthAPIHostname = 'home.nest.com';

class NestAPI extends EventEmitter {
  constructor(accessToken, config, log) {
    super();
    let self = this;
    self.accessToken = accessToken;
    self.log = log;
    // Nest needs to be reauthenticated about every hour
    const interval = setInterval(() => {
      self.reauth(config, log)
        .then(function(conn){
          return;
        })
        .then(function(data) {
          self.accessToken = config.access_token;
        })
        .catch(function(err) {
          self.log.error(err);
          if (callback) {
            callback([]);
          }
        });
    }, 3600000);
  }

  /**
   * Reauthenticate the google access user_token
   * @param config  The configuration object
   * @param log     The logger
   */
  reauth(config, log) {
    return new Promise(function (resolve, reject) {
      let self = this;
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

  /**
   * Fetch cameras from nest and add them to Homebridge
   */
  fetchCameras() {
    let self = this;
    self.sendHomeRequest('/api/cameras.get_owned_and_member_of_with_properties', 'GET')
      .then((response) => {
        let text = response.toString();
        let json = JSON.parse(text);
        if (json.status === 0) {
          var cameras = [];
          json.items.forEach((cameraInfo) => {
            let camera = new NestCam(self, cameraInfo, self.log);
            cameras.push(camera);
          });
          self.emit('cameras', cameras);
        } else {
          self.log.error('Failed to load cameras. ' + json.status_detail);
        }
      })
      .catch((err) => {
        self.log.error('Failed to load cameras. ' + err.message);
      });
  }

  /**
   * Send api request to the camera endpoint
   * @param endpoint  The endpoint to send the request
   * @param method    Usually "GET" or "POST"
   * @param body      The body of the request or null if a "GET"
   */
  sendHomeRequest(endpoint, method, body) {
    let self = this;
    return self.sendRequest(NestAPIHostname, endpoint, method, body);
  }

  /**
   * Send a generic api request
   * @param hostname  The base uri to send the request
   * @param endpoint  The endpoint to send the request
   * @param method    Usually "GET" or "POST"
   * @param body      The body of the request or null if a "GET"
   */
  sendRequest(hostname, endpoint, method, body) {
    let self = this;

    return new Promise((resolve, reject) => {
      let headers = {
        'User-Agent': 'iPhone iPhone OS 11.0 Dropcam/5.14.0 com.nestlabs.jasper.release Darwin',
        'Referer': 'https://home.nest.com/'
      };

      if (method === 'POST') {
        headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=utf-8';
      }

      if (self.accessToken !== undefined) {
        headers['Cookie'] = 'user_token=' + self.accessToken;
      }

      let options = {
        hostname: hostname,
        path: endpoint,
        method: method,
        headers: headers
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
      if (body !== undefined) {
        req.write(body);
      }
      req.end();
    });
  }
}

module.exports = {
  NestAPI: NestAPI
};
