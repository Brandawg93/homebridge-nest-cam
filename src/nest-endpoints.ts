import axios from 'axios';
import { AxiosRequestConfig, Method, ResponseType } from 'axios';

/**
 * Class used to communicate with Nest
 * @param {boolean} fieldTestMode Whether or not the account is a field tester
 */
export class NestEndpoints {
  public static USER_AGENT_STRING =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/77.0.3865.120 Safari/537.36';
  public NEST_API_HOSTNAME = 'https://home.nest.com';
  public CAMERA_API_HOSTNAME = 'https://webapi.camera.home.nest.com';
  public CAMERA_AUTH_COOKIE = 'website_2';

  constructor(fieldTestMode: boolean) {
    if (fieldTestMode) {
      this.NEST_API_HOSTNAME = 'https://home.ft.nest.com';
      this.CAMERA_API_HOSTNAME = 'https://webapi.camera.home.ft.nest.com';
      this.CAMERA_AUTH_COOKIE = 'website_ft';
    }
  }

  /**
   * Send a generic api request
   * @param {string} accessToken  The token used to authenticate request
   * @param {string} hostname     The base uri to send the request
   * @param {string} endpoint     The endpoint to send the request
   * @param {Method} method       Usually 'GET' or 'POST'
   * @param {ResponseType} type   The type of return object (Usually 'json')
   * @param {any} body            The body of the request or null if a 'GET'
   */
  async sendRequest(
    accessToken: string | undefined,
    hostname: string,
    endpoint: string,
    method: Method,
    type: ResponseType = 'json',
    data?: any,
  ): Promise<any> {
    const headers: any = {
      'User-Agent': NestEndpoints.USER_AGENT_STRING,
      Referer: this.NEST_API_HOSTNAME,
    };

    if (method === 'POST') {
      headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=utf-8';
    }

    if (accessToken) {
      headers['Cookie'] = `user_token=${accessToken}`;
    }

    const url = hostname + endpoint;
    const req: AxiosRequestConfig = {
      method,
      url,
      data,
      headers,
      responseType: type,
    };

    return (await axios(req)).data;
  }
}
