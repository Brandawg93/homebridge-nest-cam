import { NestCam } from '../src/nest/cam';
import { NestConfig } from '../src/nest/models/config';
import { auth, getCameras } from '../src/nest/connection';

test('checkAlerts works as expected', async () => {
  expect.assertions(1);
  const issueToken = process.env.ISSUE_TOKEN || '';
  const cookies = process.env.COOKIES || '';
  const accessToken = await auth(issueToken, cookies);
  if (accessToken) {
    const config: NestConfig = {
      platform: 'test',
      fieldTest: false,
      access_token: accessToken,
    };
    const cameraInfo = (await getCameras(config))[0];
    const camera = new NestCam(config, cameraInfo);
    return expect(camera.checkAlerts()).resolves.toBeUndefined();
  } else {
    throw new Error('Could not connect');
  }
});
