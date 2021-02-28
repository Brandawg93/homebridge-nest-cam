import { Logging } from 'homebridge';
import { NestEndpoints, handleError } from './endpoints';
import { NestCam, NestCamEvents } from './cam';
import { Session, AppLaunch } from './models/session';
import { NestConfig } from './models/config';

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
  private readonly config: NestConfig;
  private readonly log: Logging | undefined;
  private subscribeFailures = 0;
  private nestUserID = '';

  constructor(config: NestConfig, log?: Logging) {
    this.endpoints = new NestEndpoints(config.options?.fieldTest);
    this.config = config;
    this.log = log;
  }

  private async getUserID(): Promise<string> {
    try {
      const session: Session = await this.endpoints.sendRequest(
        this.config.access_token,
        this.endpoints.CAMERA_API_HOSTNAME,
        '/api/v1/users.get_current',
        'GET',
      );
      const userId = session.items[0].nest_user_id;
      this.nestUserID = userId;
      return userId;
    } catch (error) {
      handleError(this.log, error, 'Error fetching session');
      return '';
    }
  }

  async getAppLaunch(): Promise<AppLaunch | undefined> {
    const userId = this.nestUserID || (await this.getUserID());
    if (userId) {
      const data = {
        known_bucket_types: KNOWN_BUCKET_TYPES,
        known_bucket_versions: [],
      };

      try {
        const appLaunch: AppLaunch = await this.endpoints.sendRequest(
          this.config.access_token,
          this.endpoints.NEST_API_HOSTNAME,
          `/api/0.1/user/${userId}/app_launch`,
          'POST',
          'json',
          'application/json,text/json,text/javascript',
          true,
          data,
        );
        return appLaunch;
      } catch (error) {
        handleError(this.log, error, 'Error fetching app_launch');
      }
    }
  }

  async subscribe(cameras: Array<NestCam>): Promise<void> {
    const appLaunch = await this.getAppLaunch();
    const userId = this.nestUserID || (await this.getUserID());
    if (appLaunch) {
      const currDate = new Date();
      const epoch = Math.round(currDate.getTime() / 1000);

      const data = {
        objects: appLaunch.updated_buckets,
        timeout: SUBSCRIBE_TIMEOUT,
        sessionID: `ios-${userId}.${String(Math.random()).substr(2, 5)}.${epoch}`,
      };

      try {
        const response: any = await this.endpoints.sendRequest(
          this.config.access_token,
          appLaunch.service_urls.urls.transport_url,
          '/v6/subscribe',
          'POST',
          'json',
          'application/json,text/json,text/javascript',
          false,
          data,
        );

        this.subscribeFailures = 0;
        const objects = response.objects;
        if (objects && Array.isArray(objects)) {
          for (const object of objects) {
            if (object.object_key) {
              const uuid = object.object_key.split('.')[1];
              const camera = cameras.find((x) => x.info.uuid === uuid);
              if (camera) {
                this.log?.debug(`Updating info for ${camera.info.name}`);
                const curr_streaming = camera.info.properties['streaming.enabled'];
                const curr_chime = camera.info.properties['doorbell.indoor_chime.enabled'];
                const curr_assist = camera.info.properties['doorbell.chime_assist.enabled'];
                const curr_audio = camera.info.properties['audio.enabled'];

                camera
                  .updateData()
                  .then((info) => {
                    const newProps = info.properties;
                    if (curr_streaming !== newProps['streaming.enabled']) {
                      camera.emit(NestCamEvents.CAMERA_STATE_CHANGED, newProps['streaming.enabled']);
                    }
                    if (curr_chime !== newProps['doorbell.indoor_chime.enabled']) {
                      camera.emit(NestCamEvents.CHIME_STATE_CHANGED, newProps['doorbell.indoor_chime.enabled']);
                    }
                    if (curr_assist !== newProps['doorbell.chime_assist.enabled']) {
                      camera.emit(NestCamEvents.CHIME_ASSIST_STATE_CHANGED, newProps['doorbell.chime_assist.enabled']);
                    }
                    if (curr_audio !== newProps['audio.enabled']) {
                      camera.emit(NestCamEvents.AUDIO_STATE_CHANGED, newProps['audio.enabled']);
                    }
                  })
                  .catch((error) => {
                    handleError(this.log, error, 'Error updating camera info', true);
                  });
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
