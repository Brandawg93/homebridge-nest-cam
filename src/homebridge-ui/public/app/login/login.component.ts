import { Component, OnInit } from '@angular/core';
import '@homebridge/plugin-ui-utils/dist/ui.interface';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css'],
})
export class LoginComponent implements OnInit {
  public issueToken = '';
  public cookies = '';
  public isLoggedIn = false;
  public authenticated = false;
  private homebridge = window.homebridge;
  public errMsg = '';

  constructor() {
    this.homebridge.showSpinner();
    this.homebridge.addEventListener('auth-error', () => {
      console.log('auth error');
    });
  }

  async ngOnInit(): Promise<void> {
    const config = await this.homebridge.getPluginConfig();
    this.issueToken = config[0].googleAuth?.issueToken;
    this.cookies = config[0].googleAuth?.cookies;
    if (this.issueToken && this.cookies) {
      this.authenticated = await this.homebridge.request('/auth', {
        issueToken: this.issueToken,
        cookies: this.cookies,
      });
      if (this.authenticated) {
        this.isLoggedIn = true;
      } else {
        this.doLogin();
      }
    } else {
      this.doLogin();
    }
    this.homebridge.hideSpinner();
  }

  doLogin(): void {
    // Login
  }
}
