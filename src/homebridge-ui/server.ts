import { HomebridgePluginUiServer } from '@homebridge/plugin-ui-utils';
import { auth } from '../nest/connection';

class UiServer extends HomebridgePluginUiServer {
  constructor() {
    super();

    this.onRequest('/auth', this.handleAuthRequest.bind(this));

    this.ready();
    setTimeout(() => {
      this.pushEvent('auth-error', { message: 'Something went wrong.' });
    }, 2000);
  }

  /**
   * Example only.
   * Handle requests made from the UI to the `/hello` endpoint.
   */
  async handleAuthRequest(payload: any): Promise<boolean> {
    const accessToken = await auth(payload.issueToken, payload.cookies);
    if (accessToken) {
      return true;
    } else {
      return false;
    }
  }
}

// start the instance of the class
((): UiServer => {
  return new UiServer();
})();
