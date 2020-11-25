import { Logging } from 'homebridge';
import axios from 'axios';
import { NestEndpoints, handleError } from './endpoints';
import { AxiosRequestConfig } from 'axios';
import { NestConfig } from './models/config';
import { CameraInfo } from './models/camera';
import querystring from 'querystring';

// Delay after authentication fail before retrying
const API_AUTH_FAIL_RETRY_DELAY_SECONDS = 15;

// Timeout other API calls after this number of seconds
const API_TIMEOUT_SECONDS = 40;

const delay = function (time: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, time));
};

/**
 * Get info on all cameras
 */
export async function getCameras(config: NestConfig, log?: Logging): Promise<Array<CameraInfo>> {
  const endpoints = new NestEndpoints(config.fieldTest);
  let cameras: Array<CameraInfo> = [];
  try {
    const response = await endpoints.sendRequest(
      config.access_token,
      endpoints.CAMERA_API_HOSTNAME,
      '/api/cameras.get_owned_and_member_of_with_properties',
      'GET',
    );
    cameras = response.items;
  } catch (error) {
    if (log) {
      handleError(log, error, 'Error fetching cameras');
    }
  }
  return cameras;
}

/**
 * Attempt to authenticate Nest via Google account
 */
export async function auth(issueToken: string, cookies: string, apiKey?: string, log?: Logging): Promise<string> {
  let req: AxiosRequestConfig;

  //Only doing google auth from now on
  issueToken = issueToken.replace('Request URL: ', '');
  cookies = cookies.replace('cookie: ', '');
  const referer = querystring.parse(issueToken).ss_domain;
  if (!referer) {
    log?.error('issueToken is invalid');
    return '';
  }
  const fieldTest = referer !== 'https://home.nest.com';

  apiKey =
    apiKey?.replace('x-goog-api-key: ', '') ||
    (fieldTest ? 'AIzaSyB0WNyJX2EQQujlknzTDD9jz7iVHK5Jn-U' : 'AIzaSyAdkSIMNc51XGNEAYWasX9UOWkS5P6sZE4');

  log?.debug('Authenticating via Google.');
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
      log?.error(
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
        Referer: referer,
      },
    };
    result = (await axios(req)).data;
    return result.jwt;
  } catch (error) {
    error.status = error.response && error.response.status;
    log?.error('Access token acquisition via googleAuth failed (code ' + (error.status || error.code) + ').');
    if (['ECONNREFUSED', 'ESOCKETTIMEDOUT', 'ECONNABORTED', 'ENOTFOUND', 'ENETUNREACH'].includes(error.code)) {
      log?.error('Retrying in ' + API_AUTH_FAIL_RETRY_DELAY_SECONDS + ' second(s).');
      await delay(API_AUTH_FAIL_RETRY_DELAY_SECONDS * 1000);
      return await auth(issueToken, cookies);
    } else {
      return '';
    }
  }
}
