import { Logging } from 'homebridge';
import axios from 'axios';
import { NestEndpoints, handleError } from './endpoints';
import { AxiosRequestConfig } from 'axios';
import { NestConfig } from './models/config';
import { CameraInfo } from './models/camera';
import querystring from 'querystring';
import crypto from 'crypto';
import base64url from 'base64url';

type Token = {
  url: string;
  code: string;
};

const REDIRECT_URI = 'com.googleusercontent.apps.733249279899-1gpkq9duqmdp55a7e5lft1pr2smumdla:/oauth2callback';
const REDIRECT_URI_FT = 'com.googleusercontent.apps.384529615266-57v6vaptkmhm64n9hn5dcmkr4at14p8j:/oauthredirect';
const CLIENT_ID = '733249279899-1gpkq9duqmdp55a7e5lft1pr2smumdla.apps.googleusercontent.com';
const CLIENT_ID_FT = '384529615266-57v6vaptkmhm64n9hn5dcmkr4at14p8j.apps.googleusercontent.com';
const AUDIENCE = '733249279899-spjd3qvje0svjorc6j5lit5m5u8dn32e.apps.googleusercontent.com';
const AUDIENCE_FT = '384529615266-fs1uiloq0rbmjtun2njct601pnuhqddo.apps.googleusercontent.com';
const APIKEY = 'AIzaSyAdkSIMNc51XGNEAYWasX9UOWkS5P6sZE4';
const APIKEY_FT = 'AIzaSyB0WNyJX2EQQujlknzTDD9jz7iVHK5Jn-U';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ISSUE_JWT_URL = 'https://nestauthproxyservice-pa.googleapis.com/v1/issue_jwt';

// Delay after authentication fail before retrying
const API_AUTH_FAIL_RETRY_DELAY_SECONDS = 15;

// Timeout other API calls after this number of seconds
const API_TIMEOUT_SECONDS = 40;

const delay = function (time: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, time));
};

const randomStr = (len: number): string => {
  let result = '';
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const charactersLength = characters.length;
  for (let i = 0; i < len; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
};

const codeChallenge = (str: string): string => {
  const hash = crypto.createHash('sha256');
  hash.update(str);
  return base64url(hash.digest());
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
export function generateToken(ft = false): Token {
  const code = randomStr(43); // This is the code verifier
  const data = {
    nonce: randomStr(43),
    audience: ft ? AUDIENCE_FT : AUDIENCE,
    response_type: 'code',
    code_challenge_method: 'S256',
    scope: 'openid profile email https://www.googleapis.com/auth/nest-account',
    code_challenge: codeChallenge(code),
    redirect_uri: ft ? REDIRECT_URI_FT : REDIRECT_URI,
    client_id: ft ? CLIENT_ID_FT : CLIENT_ID,
    state: randomStr(43),
  };
  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${querystring.stringify(data)}`, code: code };
}

export async function getRefreshToken(requestUrl: string, code_verifier: string, ft = false): Promise<string> {
  const code = querystring.parse(requestUrl).code;
  const req: AxiosRequestConfig = {
    method: 'POST',
    url: TOKEN_URL,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': NestEndpoints.USER_AGENT_STRING,
    },
    data: querystring.stringify({
      code: code,
      code_verifier: code_verifier,
      redirect_uri: ft ? REDIRECT_URI_FT : REDIRECT_URI,
      client_id: ft ? CLIENT_ID_FT : CLIENT_ID,
      grant_type: 'authorization_code',
    }),
  };
  const result = (await axios(req)).data;
  return result.refresh_token;
}

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
  } catch (error) {
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
