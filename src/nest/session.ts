import { Logging, PlatformConfig } from 'homebridge';
import { NestEndpoints, handleError } from './endpoints';
import { NestCam, NestCamEvents } from './cam';
import axios from 'axios';
import { AxiosRequestConfig } from 'axios';
import { Session, AppLaunch } from './models/session-info';

const KNOWN_BUCKET_TYPES = [
  // 'buckets',
  // 'delayed_topaz',
  // 'demand_response',
  // 'device',
  // 'device_alert_dialog',
  // 'geofence_info',
  // 'kryptonite',
  // 'link',
  // 'message',
  // 'message_center',
  // 'metadata',
  // 'occupancy',
  'quartz',
  // 'safety',
  // 'rcs_settings',
  // 'safety_summary',
  // 'schedule',
  // 'shared',
  // 'structure',
  // 'structure_history',
  // 'structure_metadata',
  // 'topaz',
  // 'topaz_resource',
  // 'track',
  // 'trip',
  // 'tuneups',
  // 'user',
  // 'user_alert_dialog',
  // 'user_settings',
  // 'where',
  // 'widget_track',
];

const SUBSCRIBE_TIMEOUT = 850 + Math.round(250 * Math.random());
const RETRY_INTERVAL = 10000;

const delay = function (time: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, time));
};

export class NestSession {
  private endpoints: NestEndpoints;
  private readonly config: PlatformConfig;
  private readonly log: Logging;
  private subscribeFailures = 0;

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
        url: `${this.endpoints.NEST_API_HOSTNAME}/session?_=${epoch}`,
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

  async getAppLaunch(session: Session | undefined): Promise<AppLaunch | undefined> {
    if (session) {
      const data = {
        known_bucket_types: KNOWN_BUCKET_TYPES,
        known_bucket_versions: [],
      };

      try {
        const req: AxiosRequestConfig = {
          method: 'POST',
          url: `${this.endpoints.NEST_API_HOSTNAME}/api/0.1/user/${session.userid}/app_launch`,
          headers: {
            Authorization: 'Basic ' + this.config.access_token,
            'User-Agent': NestEndpoints.USER_AGENT_STRING,
            Referer: this.endpoints.NEST_API_HOSTNAME,
            Cookie: `user_token=${this.config.access_token}`,
          },
          data: data,
        };
        return (await axios(req)).data as AppLaunch;
      } catch (error) {
        handleError(this.log, error, 'Error fetching app_launch');
      }
    }
  }

  async subscribe(cameras: Array<NestCam>): Promise<void> {
    const session = await this.getSessionInfo();
    const appLaunch = await this.getAppLaunch(session);
    if (appLaunch) {
      const currDate = new Date();
      const epoch = Math.round(currDate.getTime() / 1000);

      const data = {
        objects: appLaunch.updated_buckets,
        timeout: SUBSCRIBE_TIMEOUT,
        sessionID: `${session?.userid}.${String(Math.random()).substr(2, 5)}.${epoch}`,
      };

      try {
        const req: AxiosRequestConfig = {
          method: 'POST',
          timeout: SUBSCRIBE_TIMEOUT * 1e3,
          url: `${appLaunch.service_urls.urls.transport_url}/v5/subscribe`,
          headers: {
            Authorization: 'Basic ' + this.config.access_token,
            'User-Agent': NestEndpoints.USER_AGENT_STRING,
            Referer: this.endpoints.NEST_API_HOSTNAME,
          },
          data: data,
        };
        const response = (await axios(req)).data;
        this.subscribeFailures = 0;
        const objects = response.objects;
        if (objects && Array.isArray(objects)) {
          for (const object of objects) {
            if (object.object_key) {
              const uuid = object.object_key.split('.')[1];
              const camera = cameras.find((x) => x.info.uuid === uuid);
              if (camera) {
                this.log.debug(`Updating info for ${camera.info.name}`);
                const curr_streaming = camera.info.properties['streaming.enabled'];
                const curr_chime = camera.info.properties['doorbell.indoor_chime.enabled'];
                const curr_audio = camera.info.properties['audio.enabled'];

                const newProps = (await camera.updateData()).properties;
                if (curr_streaming !== newProps['streaming.enabled']) {
                  camera.emit(NestCamEvents.CAMERA_STATE_CHANGED, newProps['streaming.enabled']);
                }
                if (curr_chime !== newProps['doorbell.indoor_chime.enabled']) {
                  camera.emit(NestCamEvents.CHIME_STATE_CHANGED, newProps['doorbell.indoor_chime.enabled']);
                }
                if (curr_audio !== newProps['audio.enabled']) {
                  camera.emit(NestCamEvents.AUDIO_STATE_CHANGED, newProps['audio.enabled']);
                }
              }
            }
          }
        }
      } catch (error) {
        handleError(this.log, error, 'Error subscribing', true);
        if (this.subscribeFailures < 10) {
          this.subscribeFailures++;
        }

        await delay(RETRY_INTERVAL * Math.pow(this.subscribeFailures, 2));
      } finally {
        await this.subscribe(cameras);
      }
    }
  }
}
