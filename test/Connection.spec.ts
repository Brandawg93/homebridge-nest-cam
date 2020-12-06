import { auth } from '../src/nest/connection';

test('works as expected', async () => {
  const issueToken = process.env.ISSUE_TOKEN || '';
  const cookies = process.env.COOKIES || '';
  expect.assertions(1);
  const accessToken = await auth(issueToken, cookies);
  return expect(accessToken.length > 0).toBeTruthy();
});
