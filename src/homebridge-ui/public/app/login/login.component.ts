import { Component, OnInit } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import '@homebridge/plugin-ui-utils/dist/ui.interface';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css'],
})
export class LoginComponent implements OnInit {
  public form?: FormGroup;
  public manualLogin = false;
  private homebridge = window.homebridge;
  public errMsg = '';

  constructor() {
    this.homebridge.addEventListener('auth-error', (event: any) => {
      this.errMsg = event.data.message;
    });
  }

  generateForm(): void {
    this.form = new FormGroup({
      issueToken: new FormControl('', Validators.required),
      cookies: new FormControl('', Validators.required),
    });

    this.form.valueChanges.subscribe((value) => {
      // Do something here
    });
  }

  async ngOnInit(): Promise<void> {
    this.generateForm();
  }

  doLogin(): void {
    // Login
  }
}
