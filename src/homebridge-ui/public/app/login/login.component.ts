import { Component, OnInit, Output, EventEmitter } from '@angular/core';
import { trigger, transition, style, animate } from '@angular/animations';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { NestConfig } from '../../../../nest/models/config';
import { Token } from '../../../../nest/connection';
import '@homebridge/plugin-ui-utils/dist/ui.interface';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css'],
  animations: [
    trigger('opacity', [transition(':enter', [style({ opacity: 0 }), animate('200ms', style({ opacity: 1 }))])]),
  ],
})
export class LoginComponent implements OnInit {
  public manualForm?: FormGroup;
  public autoForm?: FormGroup;
  public manualLogin = false;
  public waiting = false;
  public token: Token = {
    url: '#',
    code: '',
  };

  public totpRequired = false;
  public progress = 0;
  public color = 'blue';
  private homebridge = window.homebridge;
  public errMsg = '';
  public noticeMsg = '';
  public totp = '';

  @Output() authEvent = new EventEmitter<boolean>();

  constructor() {
    this.homebridge?.addEventListener('error', (event: any) => {
      this.errMsg = event.data;
      this.color = 'red';
    });

    this.homebridge?.addEventListener('notice', (event: any) => {
      this.noticeMsg = event.data;
    });

    this.homebridge?.addEventListener('started', async () => {
      this.progress = 20;
    });

    this.homebridge?.addEventListener('username', async () => {
      this.progress = 40;
      await this.homebridge.request('/username', this.autoForm?.controls.email.value);
    });

    this.homebridge?.addEventListener('password', async () => {
      this.progress = 60;
      await this.homebridge.request('/password', this.autoForm?.controls.password.value);
    });

    this.homebridge?.addEventListener('totp', async () => {
      this.totpRequired = true;
    });

    this.homebridge?.addEventListener('credentials', async (payload: any) => {
      await this.checkAuthentication(payload.data);
    });

    this.generateForm();
  }

  private resetLoginUI(): void {
    this.waiting = true;
    this.color = 'blue';
    this.progress = 0;
    this.errMsg = '';
    this.noticeMsg = '';
  }

  generateForm(): void {
    this.manualForm = new FormGroup({
      requestUrl: new FormControl('', Validators.required),
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
    const config = ((await this.homebridge.getPluginConfig())[0] || {}) as NestConfig;
    const ft = config.options?.fieldTest;
    this.token = await this.homebridge.request('/generateToken', { ft: ft });
  }

  toggleLogin(): void {
    this.manualLogin = !this.manualLogin;
  }

  private async checkAuthentication(refreshToken: string): Promise<void> {
    const config = ((await this.homebridge.getPluginConfig())[0] || {}) as NestConfig;
    const authenticated = await this.homebridge.request('/auth', {
      refreshToken: refreshToken,
      ft: config.options?.fieldTest,
    });
    if (authenticated) {
      this.progress = 100;
      this.color = 'green';
      await delay(500);
      config.refreshToken = refreshToken;
      await this.homebridge.updatePluginConfig([config]);
      await this.homebridge.savePluginConfig();
      this.authEvent.emit(true);
      this.waiting = false;
      this.homebridge.showSpinner();
    } else {
      this.errMsg = 'Unable to authenticate via the provided refresh token';
      this.color = 'red';
    }
  }

  async doManualLogin(): Promise<void> {
    this.resetLoginUI();
    const config = ((await this.homebridge.getPluginConfig())[0] || {}) as NestConfig;
    const ft = config.options?.fieldTest;
    const code_verifier = this.token?.code;
    const requestUrl = this.manualForm?.controls.requestUrl.value;
    const refreshToken = await this.homebridge.request('/getRefreshToken', {
      url: requestUrl,
      code_verifier: code_verifier,
      ft: ft,
    });
    if (refreshToken) {
      await this.checkAuthentication(refreshToken);
    }
  }

  async doAutoLogin(): Promise<void> {
    this.resetLoginUI();
    await this.homebridge?.request('/login');
  }

  async restart(): Promise<void> {
    this.waiting = false;
    await this.homebridge.request('/stop');
  }

  async confirmTotp(): Promise<void> {
    await this.homebridge.request('/totp', this.totp);
    this.progress = 80;
    this.totp = '';
    this.totpRequired = false;
  }
}
