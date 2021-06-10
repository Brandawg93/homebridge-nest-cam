import { Component, OnInit } from '@angular/core';
import { trigger, transition, style, animate } from '@angular/animations';
import { CameraInfo, Zone } from '../../../nest/models/camera';
import { IHomebridgeUiFormHelper } from '@homebridge/plugin-ui-utils/dist/ui.interface';
import { NestConfig } from '../../../nest/models/config';
import '@homebridge/plugin-ui-utils/dist/ui.interface';
import { Face } from '../../../nest/models/structure';

interface Profile {
  name: string;
  email: string;
  img: string;
}
@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
  animations: [
    trigger('profileTrigger', [
      transition(':enter', [style({ height: 0, opacity: 0 }), animate('200ms', style({ height: 43, opacity: 1 }))]),
      transition(':leave', [animate('200ms', style({ height: 0, opacity: 0 }))]),
    ]),
    trigger('opacity', [transition(':enter', [style({ opacity: 0 }), animate('200ms', style({ opacity: 1 }))])]),
  ],
})
export class AppComponent implements OnInit {
  public title = 'homebridge-ui';
  public authenticated = true;
  public initialized = false;
  public ft = false;
  public profile: Profile | undefined;
  public form: IHomebridgeUiFormHelper | undefined;
  private homebridge = window.homebridge;

  constructor() {
    this.homebridge?.showSpinner();
  }

  async setAuthenticated(authenticated: boolean): Promise<void> {
    this.initialized = false;
    this.authenticated = authenticated;
    if (authenticated) {
      await this.showForm();
      const owner = await this.homebridge.request('/owner');
      if (owner) {
        this.profile = {
          name: owner.name,
          email: owner.email,
          img: owner.profile_image_url,
        };
      }
    }
    this.initialized = true;
  }

  async showForm(config?: NestConfig | undefined): Promise<void> {
    // create the form
    const self = this;
    if (!config) {
      config = (await this.homebridge.getPluginConfig())[0] as NestConfig;
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
    }
  }

  async signout(): Promise<void> {
    this.authenticated = false;
    // stop listening to change events and hide the form
    this.form?.end();
    const config = (await this.homebridge.getPluginConfig())[0] as NestConfig;
    if (config) {
      config.refreshToken = '';
      await self.homebridge.updatePluginConfig([config]);
      await this.homebridge.savePluginConfig();
    }
    await this.homebridge.request('/logout');
  }

  async ngOnInit(): Promise<void> {
    if (!this.homebridge) {
      return;
    }
    const config = (await this.homebridge.getPluginConfig())[0] as NestConfig;
    if (!config) {
      this.authenticated = false;
      this.homebridge?.hideSpinner();
      return;
    }
    const refreshToken = config.refreshToken;
    this.ft = config.options?.fieldTest || false;
    if (refreshToken) {
      this.authenticated = await this.homebridge.request('/auth', {
        refreshToken: refreshToken,
        ft: this.ft,
      });
      if (this.authenticated) {
        await this.showForm(config);
        const owner = await this.homebridge.request('/owner');
        if (owner) {
          this.profile = {
            name: owner.name,
            email: owner.email,
            img: owner.profile_image_url,
          };
        }
      } else {
        this.homebridge?.hideSpinner();
      }
    } else {
      this.authenticated = false;
      this.homebridge?.hideSpinner();
    }
    this.initialized = true;
  }

  async modifySchema(schema: Record<string, any>): Promise<Record<string, any>> {
    const cameras = (await this.homebridge.request('/cameras')) as Array<CameraInfo>;
    if (cameras && cameras.length > 0 && schema && schema.options && schema.options.properties) {
      const hasDoorbell = cameras.some((c) => c.capabilities.includes('indoor_chime'));
      const hasMotion = cameras.some((c) => c.capabilities.includes('detectors.on_camera'));
      const hasStrangerDetection = cameras.some((c) => c.capabilities.includes('stranger_detection'));
      // Remove options if user does not have a doorbell
      if (!hasDoorbell) {
        delete schema.options.properties.doorbellAlerts;
        delete schema.options.properties.doorbellSwitch;
        delete schema.options.properties.chimeSwitch;
      }
      // Remove options if user does not have a motion camera
      if (!hasMotion) {
        delete schema.options.properties.alertCheckRate;
        delete schema.options.properties.alertCooldownRate;
        delete schema.options.properties.alertTypes;
        delete schema.options.properties.importantOnly;
        delete schema.options.properties.motionDetection;
      }
      // Remove options if user does not have camera with face detection
      if (!hasStrangerDetection && schema.options.properties.alertTypes && schema.options.properties.alertTypes.items) {
        const oneOf = schema.options.properties.alertTypes.items.oneOf;
        schema.options.properties.alertTypes.items.oneOf = oneOf.filter((obj: any) => {
          const title = obj.title;
          return title !== 'Package Retrieved' && title !== 'Package Delivered' && title !== 'Face';
        });
      }
      // Add faces if user has camera with face detection
      if (hasStrangerDetection && schema.options.properties.alertTypes && schema.options.properties.alertTypes.items) {
        const faces = (await this.homebridge.request('/faces')) as Array<Face> | undefined;
        const oneOf = schema.options.properties.alertTypes.items.oneOf;
        oneOf.push({ title: 'Face - Unknown', enum: ['Face - Unknown'] });
        schema.options.properties.alertTypes.items.oneOf = oneOf
          .concat(
            faces
              ?.filter((face: Face) => {
                return face.name;
              })
              .map((face: Face) => {
                return { title: `Face - ${face.name}`, enum: [`Face - ${face.name}`] };
              }),
          )
          .filter((obj: any) => {
            return obj.title !== 'Face';
          });
      }
      // Add zones if user has camera with zones
      if (schema.options.properties.alertTypes && schema.options.properties.alertTypes.items) {
        const zones = (await this.homebridge.request('/zones')) as Array<Zone> | undefined;
        const oneOf = schema.options.properties.alertTypes.items.oneOf;
        schema.options.properties.alertTypes.items.oneOf = oneOf
          .concat(
            zones
              ?.filter((zone: Zone) => {
                return zone.label;
              })
              .map((zone: Zone) => {
                return { title: `Zone - ${zone.label}`, enum: [`Zone - ${zone.label}`] };
              }),
          )
          .filter((obj: any) => {
            return obj.title !== 'Zone';
          });
      }
      // Remove options if user only has one structure
      if (schema.options.properties.structures && schema.options.properties.structures.items) {
        const structures = await this.homebridge.request('/structures');
        if (structures && structures.length > 1) {
          schema.options.properties.structures.items.oneOf = structures;
        } else {
          delete schema.options.properties.structures;
        }
      }
      // Remove options if user only has one camera
      if (schema.options.properties.cameras && schema.options.properties.cameras.items) {
        if (cameras.length > 1) {
          schema.options.properties.cameras.items.oneOf = cameras.map((camera) => {
            return { title: camera.name, enum: [camera.uuid] };
          });
        } else {
          delete schema.options.properties.cameras;
        }
      }
    }
    return schema;
  }
}
