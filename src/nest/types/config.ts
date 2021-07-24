import { PlatformConfig } from 'homebridge';

type AlertType = 'Motion' | 'Sound' | 'Person' | 'Package Delivered' | 'Package Retrieved' | 'Face' | 'Zone';

interface GoogleAuth {
  apiKey?: string;
  issueToken?: string;
  cookies?: string;
}

interface Options {
  ffmpegCodec?: string;
  fieldTest?: boolean;
  streamQuality?: number;
  alertCheckRate?: number;
  alertCooldownRate?: number;
  alertTypes?: Array<AlertType>;
  importantOnly?: boolean;
  motionDetection?: boolean;
  doorbellAlerts?: boolean;
  doorbellSwitch?: boolean;
  streamingSwitch?: boolean;
  chimeSwitch?: boolean;
  announcementsSwitch?: boolean;
  audioSwitch?: boolean;
  pathToFfmpeg?: string;
  structures?: Array<string>;
  cameras?: Array<string>;
}

export interface NestConfig extends PlatformConfig {
  googleAuth?: GoogleAuth;
  refreshToken?: string;
  options?: Options;
  access_token?: string;
}
