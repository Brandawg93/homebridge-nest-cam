import { PlatformConfig } from 'homebridge';

type AlertType = 'Motion' | 'Sound' | 'Person' | 'Package Delivered' | 'Package Retrieved' | 'Face' | 'Zone';

interface GoogleAuth {
  apiKey?: string;
  issueToken?: string;
  cookies?: string;
}

interface Options {
  ffmpegCodec?: string;
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
  audioSwitch?: boolean;
  pathToFfmpeg?: string;
  structures?: Array<string>;
}

export interface NestConfig extends PlatformConfig {
  googleAuth?: GoogleAuth;
  ffmpegCodec?: string; // Leaving for backwards compatibility
  options?: Options;
  access_token?: string;
  fieldTest?: boolean;
}
