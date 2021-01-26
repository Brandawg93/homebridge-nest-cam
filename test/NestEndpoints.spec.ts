import { NestEndpoints } from '../src/nest/endpoints';

test('works as expected', async () => {
  expect.assertions(1);
  const endpoints = new NestEndpoints(false);
  const data = await endpoints.sendRequest(undefined, 'https://store.nest.com', `/mt-api/v1/current`, 'GET');
  expect(data.isLoggedIn).toBe(false);
});

test('can initialize with field test', () => {
  expect.assertions(1);
  const endpoints = new NestEndpoints(true);
  expect(endpoints.CAMERA_API_HOSTNAME).toEqual('https://webapi.camera.home.ft.nest.com');
});
