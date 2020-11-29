import { Component, OnInit } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { AppComponent } from '../app.component';
import '@homebridge/plugin-ui-utils/dist/ui.interface';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css'],
})
export class LoginComponent implements OnInit {
  public manualForm?: FormGroup;
  public autoForm?: FormGroup;
  public manualLogin = false;
  private homebridge = window.homebridge;
  public errMsg = '';

  constructor(private appComponent: AppComponent) {
    this.homebridge.addEventListener('auth-error', (event: any) => {
      this.errMsg = event.data.message;
    });
  }

  generateForm(): void {
    this.manualForm = new FormGroup({
      issueToken: new FormControl('', Validators.required),
      cookies: new FormControl('', Validators.required),
    });

    this.autoForm = new FormGroup({
      email: new FormControl('', Validators.required),
      password: new FormControl('', Validators.required),
    });

    // this.form.valueChanges.subscribe((value) => {
    //   // Do something here
    // });
  }

  async ngOnInit(): Promise<void> {
    this.generateForm();
  }

  toggleLogin(): void {
    this.manualLogin = !this.manualLogin;
  }

  async doManualLogin(): Promise<void> {
    const issueToken = this.manualForm?.controls.issueToken;
    const cookies = this.manualForm?.controls.cookies;
    if (issueToken && cookies) {
      const googleAuth = {
        issueToken: issueToken,
        cookies: cookies,
      };
      const authenticated = await this.homebridge.request('/auth', googleAuth);
      if (authenticated) {
        this.appComponent.authenticated = true;
        this.appComponent.showForm();
        const config = (await this.homebridge.getPluginConfig())[0];
        config.googleAuth = googleAuth;
        await this.homebridge.updatePluginConfig([config]);
        await this.homebridge.savePluginConfig();
      } else {
        // Notify user
      }
    }
  }

  doLogin(): void {
    // Login
  }
}
