import { NestSession } from '../src/nest/session';
import { NestConfig } from '../src/nest/models/config';
import { auth } from '../src/nest/connection';

const getRefreshToken = (): string => {
  const refreshToken = process.env.REFRESH_TOKEN;
  if (!refreshToken) {
    throw new Error('Refresh token not found.');
  }
  return refreshToken;
};

test('getAppLaunch works as expected', async () => {
  expect.assertions(1);
  const refreshToken = getRefreshToken();
  const accessToken = await auth(refreshToken);
  if (accessToken) {
    const config: NestConfig = {
      platform: 'test',
      fieldTest: false,
      access_token: accessToken,
    };
    const user = new NestSession(config);
    const app = await user.getAppLaunch();
    if (app) {
      return expect(app['2fa_enabled']).toBeTruthy();
    }
  } else {
    throw new Error('Could not connect');
  }
});
