import { Logger, Logging, PlatformConfig, HAP, PlatformAccessory } from 'homebridge';
import { NestCam, CameraInfo } from '../src/nestcam';
import { Connection } from '../src/nest-connection';
import { NestEndpoints } from '../src/nest-endpoints';

let hap: HAP;
const log: Logging = Logger.withPrefix('[test]');

const getCamera = async function (config: PlatformConfig): Promise<CameraInfo> {
  const endpoints = new NestEndpoints(false);
  const response = await endpoints.sendRequest(
    config.access_token,
    endpoints.CAMERA_API_HOSTNAME,
    '/api/cameras.get_owned_and_member_of_with_properties',
    'GET',
  );
  const camera: CameraInfo = response.items[0];
  return camera;
};

test('updateInfo works as expected', async () => {
  expect.assertions(1);
  const config: PlatformConfig = {
    platform: 'test',
    googleAuth: {
      issueToken: process.env.ISSUE_TOKEN,
      cookies: process.env.COOKIES,
      apiKey: process.env.API_KEY,
    },
    options: {
      fieldTest: false,
    },
  };
  const connection = new Connection(config, log);
  const connected = await connection.auth();
  if (connected) {
    const cameraInfo = await getCamera(config);
    const camera = new NestCam(config, cameraInfo, log, hap);
    return expect(camera.updateInfo()).resolves.toBeUndefined();
  } else {
    throw new Error('Could not connect');
  }
});

test('checkAlerts works as expected', async () => {
  expect.assertions(1);
  const config: PlatformConfig = {
    platform: 'test',
    googleAuth: {
      issueToken: process.env.ISSUE_TOKEN,
      cookies: process.env.COOKIES,
      apiKey: process.env.API_KEY,
    },
    options: {
      fieldTest: false,
    },
  };
  const connection = new Connection(config, log);
  const connected = await connection.auth();
  if (connected) {
    const cameraInfo = await getCamera(config);
    const uuid = '00000000-0000-0000-0000-000000000000';
    const accessory: PlatformAccessory = new PlatformAccessory('test', uuid);
    const camera = new NestCam(config, cameraInfo, log, hap);
    return expect(camera.checkAlerts(accessory)).resolves.toBeUndefined();
  } else {
    throw new Error('Could not connect');
  }
});
