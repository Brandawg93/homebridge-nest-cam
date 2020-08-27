import { Logging, PlatformConfig } from 'homebridge';
import { Logger } from 'homebridge/lib/logger';
import { NestUser } from '../src/nest-user';
import { CameraInfo } from '../src/models/camera-info';
import { Connection } from '../src/nest-connection';
import { NestEndpoints } from '../src/nest-endpoints';

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

test('getSessionInfo works as expected', async () => {
  expect.assertions(1);
  const config: PlatformConfig = {
    platform: 'test',
    googleAuth: {
      issueToken: process.env.ISSUE_TOKEN,
      cookies: process.env.COOKIES,
    },
    options: {
      fieldTest: false,
    },
  };
  const connection = new Connection(config, log);
  const connected = await connection.auth();
  if (connected) {
    const user = new NestUser(config, log);
    const session = await user.getSessionInfo();
    return expect(session).toBeDefined();
  } else {
    throw new Error('Could not connect');
  }
});
