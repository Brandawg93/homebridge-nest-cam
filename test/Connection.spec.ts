import { auth, generateToken } from '../src/nest/connection';
import { getRefreshToken, itif } from './TestBase';

itif(process.env.REFRESH_TOKEN)('works as expected', async () => {
  const refreshToken = getRefreshToken();
  expect.assertions(1);
  const accessToken = await auth(refreshToken);
  expect(accessToken.length > 0).toBeTruthy();
});

test('can generate token', async () => {
  expect.assertions(1);
  const token = generateToken();
  expect(token.length > 0).toBeTruthy();
});
