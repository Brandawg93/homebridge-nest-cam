import { auth, generateToken } from '../src/nest/connection';

test('works as expected', async () => {
  const refreshToken = process.env.REFRESH_TOKEN || '';
  expect.assertions(1);
  const accessToken = await auth(refreshToken);
  return expect(accessToken.length > 0).toBeTruthy();
});

test('can generate token', async () => {
  expect.assertions(1);
  const token = generateToken();
  return expect(token.url.length > 0).toBeTruthy();
});
