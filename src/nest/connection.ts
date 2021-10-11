import { Logging } from 'homebridge';
import axios from 'axios';
import { NestEndpoints, handleError } from './endpoints';
import { AxiosRequestConfig } from 'axios';
import { NestConfig } from './types/config';
import { CameraInfo } from './types/camera';
import querystring from 'querystring';

const CLIENT_ID = '733249279899-1gpkq9duqmdp55a7e5lft1pr2smumdla.apps.googleusercontent.com';
const CLIENT_ID_FT = '384529615266-57v6vaptkmhm64n9hn5dcmkr4at14p8j.apps.googleusercontent.com';
const APIKEY = 'AIzaSyAdkSIMNc51XGNEAYWasX9UOWkS5P6sZE4';
const APIKEY_FT = 'AIzaSyB0WNyJX2EQQujlknzTDD9jz7iVHK5Jn-U';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ISSUE_JWT_URL = 'https://nestauthproxyservice-pa.googleapis.com/v1/issue_jwt';
const NEST_AUTH_URL = 'https://webapi.camera.home.nest.com/api/v1/login.login_nest';

// Delay after authentication fail before retrying
const API_AUTH_FAIL_RETRY_DELAY_SECONDS = 15;

// Timeout other API calls after this number of seconds
const API_TIMEOUT_SECONDS = 10;

const delay = function (time: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, time));
};

/**
 * Get info on all cameras
 */
export async function getCameras(config: NestConfig, log?: Logging): Promise<Array<CameraInfo>> {
  const endpoints = new NestEndpoints(config.options?.fieldTest);
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
 * Generate url required to retrieve a refresh token
 */
export function generateToken(ft = false): string {
  const data = {
    access_type: 'offline',
    response_type: 'code',
    scope: 'openid profile email https://www.googleapis.com/auth/nest-account',
    redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
    client_id: ft ? CLIENT_ID_FT : CLIENT_ID,
  };
  return `https://accounts.google.com/o/oauth2/auth/oauthchooseaccount?${querystring.stringify(data)}`;
}

export async function getRefreshToken(code: string, ft = false): Promise<string> {
  const req: AxiosRequestConfig = {
    method: 'POST',
    timeout: API_TIMEOUT_SECONDS * 1000,
    url: TOKEN_URL,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': NestEndpoints.USER_AGENT_STRING,
    },
    data: querystring.stringify({
      code: code,
      redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
      client_id: ft ? CLIENT_ID_FT : CLIENT_ID,
      grant_type: 'authorization_code',
    }),
  };
  const result = (await axios(req)).data;
  return result.refresh_token;
}

/**
 * Attempt to authenticate Nest via Google account with refresh token
 */
export async function auth(refreshToken: string, ft = false, log?: Logging): Promise<string> {
  let req: AxiosRequestConfig;
  const apiKey = ft ? APIKEY_FT : APIKEY;

  log?.debug('Authenticating via Google refresh token.');
  let result;
  try {
    req = {
      method: 'POST',
      timeout: API_TIMEOUT_SECONDS * 1000,
      url: TOKEN_URL,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': NestEndpoints.USER_AGENT_STRING,
      },
      data: querystring.stringify({
        refresh_token: refreshToken,
        client_id: ft ? CLIENT_ID_FT : CLIENT_ID,
        grant_type: 'refresh_token',
      }),
    };
    result = (await axios(req)).data;
    const googleAccessToken = result.access_token;
    if (result.error) {
      log?.error('Google authentication was unsuccessful.');
      throw result;
    }
    req = {
      method: 'POST',
      timeout: API_TIMEOUT_SECONDS * 1000,
      url: ISSUE_JWT_URL,
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
      },
    };
    result = (await axios(req)).data;
    return result.jwt;
  } catch (error: any) {
    error.status = error.response && error.response.status;
    log?.error('Access token acquisition via refresh token failed (code ' + (error.status || error.code) + ').');
    if (['ECONNREFUSED', 'ESOCKETTIMEDOUT', 'ECONNABORTED', 'ENOTFOUND', 'ENETUNREACH'].includes(error.code)) {
      log?.error('Retrying in ' + API_AUTH_FAIL_RETRY_DELAY_SECONDS + ' second(s).');
      await delay(API_AUTH_FAIL_RETRY_DELAY_SECONDS * 1000);
      return await auth(refreshToken, ft, log);
    } else {
      return '';
    }
  }
}

/**
 * Attempt to authenticate Nest via Google account with browser cookies
 */
export async function old_auth(issueToken: string, cookies: string, apiKey?: string, log?: Logging): Promise<string> {
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
  } catch (error: any) {
    error.status = error.response && error.response.status;
    log?.error('Access token acquisition via googleAuth failed (code ' + (error.status || error.code) + ').');
    if (['ECONNREFUSED', 'ESOCKETTIMEDOUT', 'ECONNABORTED', 'ENOTFOUND', 'ENETUNREACH'].includes(error.code)) {
      log?.error('Retrying in ' + API_AUTH_FAIL_RETRY_DELAY_SECONDS + ' second(s).');
      await delay(API_AUTH_FAIL_RETRY_DELAY_SECONDS * 1000);
      return await old_auth(issueToken, cookies);
    } else {
      return '';
    }
  }
}

/**
 * Attempt to authenticate using unmigrated Nest account
 */
export async function nest_auth(nest_token: string, log?: Logging): Promise<string> {
  let req: AxiosRequestConfig;

  log?.debug('Authenticating via pre-defined nest_token');
  let result;
  try {
    req = {
      method: 'POST',
      timeout: API_TIMEOUT_SECONDS * 1000,
      url: NEST_AUTH_URL,
      data: querystring.stringify({
        access_token: nest_token,
      }),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + nest_token,
        'User-Agent': NestEndpoints.USER_AGENT_STRING,
        Referer: 'https://home.nest.com',
      },
    };
    result = (await axios(req)).data;
    if (result.error) {
      log?.error('Nest authentication was unsuccessful.');
      throw result;
    }
    return result.items[0].session_token; //return website2's session
  } catch (error: any) {
    error.status = error.response && error.response.status;
    log?.error('Nest authentication failed (code ' + (error.status || error.code) + ').');
    if (['ECONNREFUSED', 'ESOCKETTIMEDOUT', 'ECONNABORTED', 'ENOTFOUND', 'ENETUNREACH'].includes(error.code)) {
      log?.error('Retrying in ' + API_AUTH_FAIL_RETRY_DELAY_SECONDS + ' second(s).');
      await delay(API_AUTH_FAIL_RETRY_DELAY_SECONDS * 1000);
      return await nest_auth(nest_token, log);
    } else {
      return '';
    }
  }
}
