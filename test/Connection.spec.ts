import { auth, generateToken } from '../src/nest/connection';

const getRefreshToken = (): string => {
  const refreshToken = process.env.REFRESH_TOKEN;
  if (!refreshToken) {
    throw new Error('Refresh token not found.');
  }
  return refreshToken;
};

test('works as expected', async () => {
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
