import { Component, OnInit } from '@angular/core';
import { CameraInfo } from '../../../nest/models/camera';
import { IHomebridgeUiFormHelper } from '@homebridge/plugin-ui-utils/dist/ui.interface';
import '@homebridge/plugin-ui-utils/dist/ui.interface';

interface Profile {
  name: string;
  email: string;
  img: string;
}
@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
})
export class AppComponent implements OnInit {
  public title = 'homebridge-ui';
  public authenticated = true;
  public initialized = false;
  public profile: Profile | undefined;
  public form: IHomebridgeUiFormHelper | undefined;
  private homebridge = window.homebridge;

  constructor() {
    this.homebridge?.showSpinner();
  }

  async setAuthenticated(authenticated: boolean): Promise<void> {
    this.authenticated = authenticated;
    if (authenticated) {
      await this.showForm();
    }
  }

  async showForm(config?: Record<string, any> | undefined): Promise<void> {
    // create the form
    const self = this;
    if (!config) {
      config = (await this.homebridge.getPluginConfig())[0];
    }
    let schema = (await this.homebridge.getPluginConfigSchema()).schema;
    if (schema) {
      schema = await this.modifySchema(schema);
      // Remove properties not present in the schema
      for (const property in Object.keys(config)) {
        if (!schema[property]) {
          delete config[property];
        }
      }
      this.form = this.homebridge.createForm({ schema: schema }, config);
      this.homebridge?.hideSpinner();
      // watch for change events
      this.form.onChange(async (change) => {
        await self.homebridge.updatePluginConfig([change]);
      });

      // stop listening to change events and hide the form
      // form.end();
    }
  }

  async signout(): Promise<void> {
    this.authenticated = false;
    this.form?.end();
    const config = (await this.homebridge.getPluginConfig())[0];
    config.googleAuth.issueToken = '';
    config.googleAuth.cookies = '';
    await self.homebridge.updatePluginConfig([config]);
    await this.homebridge.savePluginConfig();
  }

  async ngOnInit(): Promise<void> {
    if (!this.homebridge) {
      return;
    }
    const config = (await this.homebridge.getPluginConfig())[0];
    const issueToken = config.googleAuth?.issueToken;
    const cookies = config.googleAuth?.cookies;
    if (issueToken && cookies) {
      this.authenticated = await this.homebridge.request('/auth', {
        issueToken: issueToken,
        cookies: cookies,
      });
      if (this.authenticated) {
        await this.showForm(config);
        const owner = await this.homebridge.request('/owner');
        this.profile = {
          name: owner.name,
          email: owner.email,
          img: owner.profile_image_url,
        };
        this.initialized = true;
      } else {
        this.homebridge?.hideSpinner();
        this.initialized = true;
      }
    } else {
      this.authenticated = false;
      this.homebridge?.hideSpinner();
    }
  }

  async modifySchema(schema: Record<string, any>): Promise<Record<string, any>> {
    const cameras = (await this.homebridge.request('/cameras')) as Array<CameraInfo>;
    const structures = await this.homebridge.request('/structures');

    const hasDoorbell = cameras ? cameras.some((c) => c.capabilities.includes('indoor_chime')) : false;
    const hasMotion = cameras ? cameras.some((c) => c.capabilities.includes('detectors.on_camera')) : false;
    const hasStrangerDetection = cameras ? cameras.some((c) => c.capabilities.includes('stranger_detection')) : false;

    if (schema && schema.options && schema.options.properties) {
      if (!hasDoorbell) {
        delete schema.options.properties.doorbellAlerts;
        delete schema.options.properties.doorbellSwitch;
        delete schema.options.properties.chimeSwitch;
      }
      if (!hasMotion) {
        delete schema.options.properties.alertCheckRate;
        delete schema.options.properties.alertCooldownRate;
        delete schema.options.properties.alertTypes;
        delete schema.options.properties.importantOnly;
        delete schema.options.properties.motionDetection;
      }
      if (!hasStrangerDetection) {
        const oneOf = schema.options.properties.alertTypes.items.oneOf;
        schema.options.properties.alertTypes.items.oneOf = oneOf.filter((obj: any) => {
          const title = obj.title;
          return title !== 'Package Retrieved' && title !== 'Package Delivered' && title !== 'Face';
        });
      }
      if (schema.options.properties.structures && schema.options.properties.structures.items) {
        if (structures && structures.length > 1) {
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
