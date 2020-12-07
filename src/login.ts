import { AutoLogin } from './util/login';

(async (): Promise<void> => {
  await new AutoLogin().login();
})();
