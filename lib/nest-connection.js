/**
 * Created by Adrian Cable on 7/16/19. - https://github.com/chrisjshull/homebridge-nest/blob/master/lib/nest-connection.js
 * Modified by Brandawg93 on 1/24/20.
 */

const axios = require('axios');
const NestEndpoints = require('./nest-endpoints.js');

'use strict';

// Delay after authentication fail before retrying
const API_AUTH_FAIL_RETRY_DELAY_SECONDS = 15;

// Timeout other API calls after this number of seconds
const API_TIMEOUT_SECONDS = 40;

function Connection(config, log) {
  NestEndpoints.init(config.options.fieldTest);
  this.config = config;
  this.log = log;
}

Connection.prototype.auth = async function() {
  let req;

  //Only doing google auth from now on
  let issueToken = this.config.googleAuth.issueToken;
  let cookies = this.config.googleAuth.cookies;

  this.log.debug('Authenticating via Google.');
  let result;
  try {
    req = {
      method: 'GET',
      timeout: API_TIMEOUT_SECONDS * 1000,
      url: issueToken,
      headers: {
        'Sec-Fetch-Mode': 'cors',
        'User-Agent': NestEndpoints.USER_AGENT_STRING,
        'X-Requested-With': 'XmlHttpRequest',
        'Referer': 'https://accounts.google.com/o/oauth2/iframe',
        'cookie': cookies
      }
    };
    result = (await axios(req)).data;
    let googleAccessToken = result.access_token;
    if (result.error) {
      this.log.error('Google authentication was unsuccessful. Make sure you did not log out of your Google account after getting your googleAuth parameters.');
      throw(result);
    }
    req = {
      method: 'POST',
      timeout: API_TIMEOUT_SECONDS * 1000,
      url: 'https://nestauthproxyservice-pa.googleapis.com/v1/issue_jwt',
      data: {
        embed_google_oauth_access_token: true,
        expire_after: '3600s',
        google_oauth_access_token: googleAccessToken,
        policy_id: 'authproxy-oauth-policy'
      },
      headers: {
        'Authorization': 'Bearer ' + googleAccessToken,
        'User-Agent': NestEndpoints.USER_AGENT_STRING,
        'x-goog-api-key': this.config.googleAuth.apiKey,
        'Referer': NestEndpoints.NEST_API_HOSTNAME
      }
    };
    result = (await axios(req)).data;
    this.config.access_token = result.jwt;
    return true;
  } catch(error) {
    error.status = error.response && error.response.status;
    this.log.error('Access token acquisition via googleAuth failed (code ' + (error.status || error.code) + ').');
    if (['ECONNREFUSED','ESOCKETTIMEDOUT','ECONNABORTED','ENOTFOUND','ENETUNREACH'].includes(error.code)) {
      this.log.error('Retrying in ' + API_AUTH_FAIL_RETRY_DELAY_SECONDS + ' second(s).');
      await Promise.delay(API_AUTH_FAIL_RETRY_DELAY_SECONDS * 1000);
      return await this.auth();
    } else {
      return false;
    }
  }
};

module.exports = Connection;
