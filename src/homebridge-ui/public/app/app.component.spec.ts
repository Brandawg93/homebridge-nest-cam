import { TestBed } from '@angular/core/testing';
import { AppComponent } from './app.component';
import { LoginComponent } from './login/login.component';
import { ProgressBarComponent } from './login/progress-bar/progress-bar.component';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [AppComponent, LoginComponent, ProgressBarComponent],
      imports: [FormsModule, ReactiveFormsModule],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it(`should have as title 'homebridge-ui'`, () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app.title).toEqual('homebridge-ui');
  });
});
