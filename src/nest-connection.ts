import { Logging, PlatformConfig } from 'homebridge';
import axios from 'axios';
import { NestEndpoints } from './nest-endpoints';
import { AxiosRequestConfig } from 'axios';

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
  private readonly config: PlatformConfig;
  private readonly log: Logging;

  constructor(config: PlatformConfig, log: Logging) {
    this.endpoints = new NestEndpoints(config.options.fieldTest);
    this.config = config;
    this.log = log;
  }

  /**
   * Attempt to authenticate Nest via Google account
   */
  async auth(): Promise<boolean> {
    let req: AxiosRequestConfig;

    //Only doing google auth from now on
    const issueToken = this.config.googleAuth.issueToken.replace('Request URL: ', '');
    const cookies = this.config.googleAuth.cookies.replace('cookie: ', '');
    const apiKey = this.config.googleAuth.apiKey.replace('x-goog-api-key: ', '');

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
