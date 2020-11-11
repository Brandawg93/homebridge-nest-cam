import { Component } from '@angular/core';
import '@homebridge/plugin-ui-utils/dist/ui.interface';

@Component({
  selector: 'app-textbox',
  templateUrl: './textbox.component.html',
  styleUrls: ['./textbox.component.css'],
})
export class TextboxComponent {
  version = window.homebridge?.plugin?.installedVersion;
}
