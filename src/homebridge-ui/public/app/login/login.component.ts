import { Component, OnInit, Output, EventEmitter } from '@angular/core';
import { trigger, transition, style, animate } from '@angular/animations';
import { AbstractControl, FormControl, FormGroup, ValidatorFn, Validators } from '@angular/forms';
import { NestConfig } from '../../../../nest/types/config';
import '@homebridge/plugin-ui-utils/dist/ui.interface';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function containsValidator(start: string): ValidatorFn {
  return (control: AbstractControl): { [key: string]: any } | null => {
    const contains = control.value.includes(start);
    return contains ? null : { contains: { value: control.value } };
  };
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
  public form?: FormGroup;
  public waiting = false;
  public url = '';
  public progress = 0;
  public color = 'blue';
  private homebridge = window.homebridge;
  public errMsg = '';

  @Output() authEvent = new EventEmitter<boolean>();

  constructor() {
    this.homebridge?.addEventListener('error', (event: any) => {
      this.errMsg = event.data;
      this.color = 'red';
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
  }

  generateForm(): void {
    this.form = new FormGroup({
      code: new FormControl('', [Validators.required, containsValidator('/')]),
    });

    // this.form.valueChanges.subscribe((value) => {
    //   // Do something here
    // });
  }

  async ngOnInit(): Promise<void> {
    const config = ((await this.homebridge.getPluginConfig())[0] || {}) as NestConfig;
    const ft = config.options?.fieldTest;
    this.url = await this.homebridge.request('/generateToken', { ft: ft });
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

  async doLogin(): Promise<void> {
    this.resetLoginUI();
    const config = ((await this.homebridge.getPluginConfig())[0] || {}) as NestConfig;
    const ft = config.options?.fieldTest;
    const code = this.form?.controls.code.value;
    const refreshToken = await this.homebridge.request('/getRefreshToken', {
      code: code,
      ft: ft,
    });
    if (refreshToken) {
      await this.checkAuthentication(refreshToken);
    }
  }

  async restart(): Promise<void> {
    this.waiting = false;
  }
}
