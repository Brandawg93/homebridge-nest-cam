import { Component, OnInit } from '@angular/core';
import '@homebridge/plugin-ui-utils/dist/ui.interface';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css'],
})
export class LoginComponent implements OnInit {
  issueToken = '';
  cookies = '';
  async ngOnInit(): Promise<void> {
    const config = await window.homebridge.getPluginConfig();
    this.issueToken = config[0].googleAuth?.issueToken;
    this.cookies = config[0].googleAuth?.cookies;
  }
}
