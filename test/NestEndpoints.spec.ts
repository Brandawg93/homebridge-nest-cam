import { NestEndpoints } from '../src/nest-endpoints';

test('Nest Endpoints', () => {
    let endpoints = new NestEndpoints(false);
    endpoints.sendRequest(undefined, 'https://store.nest.com', `/mt-api/v1/current`, 'GET').then(data => {
        expect(data.isLoggedIn).toBe(false);
    });
});
  