import { NestEndpoints } from '../src/nest/endpoints';

test('works as expected', () => {
  expect.assertions(1);
  const endpoints = new NestEndpoints(false);
  return endpoints
    .sendRequest(undefined, 'https://store.nest.com', `/mt-api/v1/current`, 'GET')
    .then((data) => expect(data.isLoggedIn).toBe(false));
});

test('can initialize with field test', () => {
  expect.assertions(1);
  const endpoints = new NestEndpoints(true);
  return expect(endpoints.CAMERA_API_HOSTNAME).toEqual('https://webapi.camera.home.ft.nest.com');
});
