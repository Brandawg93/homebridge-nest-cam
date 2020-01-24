'use strict';

const https = require('https');
const querystring = require('querystring');
const EventEmitter = require('events');
const NestCam = require('./nestcam').NestCam;

const NestAPIHostname = 'webapi.camera.home.nest.com';
const NestAuthAPIHostname = 'home.nest.com';

class NestAPI extends EventEmitter {
  constructor(accessToken, log) {
    super();
    let self = this;
    self.accessToken = accessToken;
    self.log = log;
  }

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

  sendHomeRequest(endpoint, method, body) {
    let self = this;
    return self.sendRequest(NestAPIHostname, endpoint, method, body);
  }

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
