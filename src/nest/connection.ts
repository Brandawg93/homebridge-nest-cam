import { Logging } from 'homebridge';
import axios from 'axios';
import { NestEndpoints, handleError } from './endpoints';
import { AxiosRequestConfig } from 'axios';
import { NestConfig } from './models/config';
import { CameraInfo } from './models/camera';

// Delay after authentication fail before retrying
const API_AUTH_FAIL_RETRY_DELAY_SECONDS = 15;

// Timeout other API calls after this number of seconds
const API_TIMEOUT_SECONDS = 40;

const delay = function (time: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, time));
};

/**
 * Class used to authenticate via Google
 * @param {PlatformConfig}  config The configuration object
 * @param {Logging}         log The logger used for output
 */
export class Connection {
  private endpoints: NestEndpoints;
  private readonly config: NestConfig;
  private readonly log: Logging;

  constructor(config: NestConfig, log: Logging) {
    this.endpoints = new NestEndpoints(config.fieldTest);
    this.config = config;
    this.log = log;
  }

  /**
   * Get info on all cameras
   */
  async getCameras(): Promise<Array<CameraInfo>> {
    let cameras: Array<CameraInfo> = [];
    try {
      const response = await this.endpoints.sendRequest(
        this.config.access_token,
        this.endpoints.CAMERA_API_HOSTNAME,
        '/api/cameras.get_owned_and_member_of_with_properties',
        'GET',
      );
      cameras = response.items;
    } catch (error) {
      handleError(this.log, error, 'Error fetching cameras');
    }
    return cameras;
  }

  /**
   * Attempt to authenticate Nest via Google account
   */
  async auth(): Promise<boolean> {
    let req: AxiosRequestConfig;

    if (!this.config.googleAuth || !this.config.googleAuth.issueToken || !this.config.googleAuth.cookies) {
      this.log.error('The plugin configuration is missing values.');
      return false;
    }

    //Only doing google auth from now on
    const issueToken = this.config.googleAuth.issueToken.replace('Request URL: ', '');
    const cookies = this.config.googleAuth.cookies.replace('cookie: ', '');
    const apiKey =
      this.config.googleAuth.apiKey?.replace('x-goog-api-key: ', '') ||
      (this.config.fieldTest ? 'AIzaSyB0WNyJX2EQQujlknzTDD9jz7iVHK5Jn-U' : 'AIzaSyAdkSIMNc51XGNEAYWasX9UOWkS5P6sZE4');

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
          Referer: 'https://accounts.google.com/o/oauth2/iframe',
          cookie: cookies,
        },
      };
      result = (await axios(req)).data;
      const googleAccessToken = result.access_token;
      if (result.error) {
        this.log.error(
          'Google authentication was unsuccessful. Make sure you did not log out of your Google account after getting your googleAuth parameters.',
        );
        throw result;
      }
      req = {
        method: 'POST',
        timeout: API_TIMEOUT_SECONDS * 1000,
        url: 'https://nestauthproxyservice-pa.googleapis.com/v1/issue_jwt',
        data: {
          embed_google_oauth_access_token: true,
          expire_after: '3600s', //expire the access token in 1 hour
          google_oauth_access_token: googleAccessToken,
          policy_id: 'authproxy-oauth-policy',
        },
        headers: {
          Authorization: 'Bearer ' + googleAccessToken,
          'User-Agent': NestEndpoints.USER_AGENT_STRING,
          'x-goog-api-key': apiKey,
          Referer: this.endpoints.NEST_API_HOSTNAME,
        },
      };
      result = (await axios(req)).data;
      this.config.access_token = result.jwt;
      return true;
    } catch (error) {
      error.status = error.response && error.response.status;
      this.log.error('Access token acquisition via googleAuth failed (code ' + (error.status || error.code) + ').');
      if (['ECONNREFUSED', 'ESOCKETTIMEDOUT', 'ECONNABORTED', 'ENOTFOUND', 'ENETUNREACH'].includes(error.code)) {
        this.log.error('Retrying in ' + API_AUTH_FAIL_RETRY_DELAY_SECONDS + ' second(s).');
        await delay(API_AUTH_FAIL_RETRY_DELAY_SECONDS * 1000);
        return await this.auth();
      } else {
        return false;
      }
    }
  }
}
