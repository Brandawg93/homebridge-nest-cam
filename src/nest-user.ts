import { Logging, PlatformConfig } from 'homebridge';
import { NestEndpoints, handleError } from './nest-endpoints';
import axios from 'axios';
import { AxiosRequestConfig } from 'axios';
import { Session } from './models/session-info';

export class User {
  private endpoints: NestEndpoints;
  private readonly config: PlatformConfig;
  private readonly log: Logging;

  constructor(config: PlatformConfig, log: Logging) {
    this.endpoints = new NestEndpoints(config.fieldTest);
    this.config = config;
    this.log = log;
  }

  async getSessionInfo(): Promise<Session | undefined> {
    try {
      const currDate = new Date();
      currDate.setMinutes(currDate.getMinutes() - 1);
      const epoch = Math.round(currDate.getTime() / 1000);
      const req: AxiosRequestConfig = {
        method: 'GET',
        url: `https://home.nest.com/session?_=${epoch}`,
        headers: {
          Authorization: 'Basic ' + this.config.access_token,
          'User-Agent': NestEndpoints.USER_AGENT_STRING,
          Referer: this.endpoints.NEST_API_HOSTNAME,
          Cookie: `user_token=${this.config.access_token}`,
        },
      };
      return (await axios(req)).data as Session;
    } catch (error) {
      handleError(this.log, error, 'Error fetching session');
    }
  }
}
