import { NestCam } from '../src/nest/cam';
import { NestConfig } from '../src/nest/types/config';
import { auth, getCameras } from '../src/nest/connection';

const getRefreshToken = (): string => {
  const refreshToken = process.env.REFRESH_TOKEN;
  if (!refreshToken) {
    throw new Error('Refresh token not found.');
  }
  return refreshToken;
};

jest.useFakeTimers();

test('checkAlerts works as expected', async () => {
  expect.assertions(1);
  const refreshToken = getRefreshToken();
  const accessToken = await auth(refreshToken);
  if (accessToken) {
    const config: NestConfig = {
      platform: 'test',
      fieldTest: false,
      access_token: accessToken,
    };
    const cameraInfo = (await getCameras(config))[0];
    const camera = new NestCam(config, cameraInfo);
    const checkAlertsSpy = jest.spyOn(NestCam.prototype as any, 'checkAlerts');
    camera.startAlertChecks();
    jest.runOnlyPendingTimers();
    camera.stopAlertChecks();
    jest.runOnlyPendingTimers();
    expect(checkAlertsSpy).toHaveBeenCalledTimes(1);
  } else {
    throw new Error('Could not connect');
  }
});
