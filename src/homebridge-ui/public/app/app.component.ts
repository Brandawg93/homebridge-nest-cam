import { Component, OnInit } from '@angular/core';
import { CameraInfo } from '../../../nest/models/camera';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
})
export class AppComponent implements OnInit {
  public title = 'homebridge-ui';
  public authenticated = true;
  private homebridge = window.homebridge;

  constructor() {
    this.homebridge.showSpinner();
  }

  async ngOnInit(): Promise<void> {
    const config = (await this.homebridge.getPluginConfig())[0];
    const issueToken = config.googleAuth?.issueToken;
    const cookies = config.googleAuth?.cookies;
    if (issueToken && cookies) {
      this.authenticated = await this.homebridge.request('/auth', {
        issueToken: issueToken,
        cookies: cookies,
      });
      if (this.authenticated) {
        // create the form
        const self = this;
        let schema = (await this.homebridge.getPluginConfigSchema()).schema;
        if (schema) {
          schema = await this.modifySchema(schema);
          const form = this.homebridge.createForm({ schema: schema }, config);
          // watch for change events
          form.onChange(async (change) => {
            await self.homebridge.updatePluginConfig([change]);
          });

          // stop listening to change events and hide the form
          // form.end();
        }
      }
    } else {
      this.authenticated = false;
    }
    this.homebridge.hideSpinner();
  }

  async modifySchema(schema: Record<string, any>): Promise<Record<string, any>> {
    const cameras = (await this.homebridge.request('/cameras')) as Array<CameraInfo>;
    const structures = await this.homebridge.request('/structures');

    const hasDoorbell = cameras.some((c) => c.capabilities.includes('indoor_chime'));
    const hasMotion = cameras.some((c) => c.capabilities.includes('detectors.on_camera'));

    if (schema && schema.options && schema.options.properties) {
      if (!hasDoorbell) {
        delete schema.options.properties.doorbellAlerts;
        delete schema.options.properties.doorbellSwitch;
      }
      if (!hasMotion) {
        delete schema.options.properties.alertCheckRate;
        delete schema.options.properties.alertCooldownRate;
        delete schema.options.properties.alertTypes;
        delete schema.options.properties.importantOnly;
        delete schema.options.properties.motionDetection;
      }
      if (schema.options.properties.structures && schema.options.properties.structures.items) {
        if (structures.length > 1) {
          schema.options.properties.structures.items.oneOf = structures;
        } else {
          delete schema.options.properties.structures;
        }
      }
    }
    return schema;
  }

  doLogin(): void {
    // Login
  }
}