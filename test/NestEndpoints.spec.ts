import { NestEndpoints } from '../src/nest-endpoints';

test('works as expected', () => {
  const endpoints = new NestEndpoints(false);
  expect.assertions(1);
  return endpoints
    .sendRequest(undefined, 'https://store.nest.com', `/mt-api/v1/current`, 'GET')
    .then((data) => expect(data.isLoggedIn).toBe(false));
});
