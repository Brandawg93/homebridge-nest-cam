import { TestBed } from '@angular/core/testing';
import { TextboxComponent } from './textbox.component';

describe('TextboxComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [TextboxComponent],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(TextboxComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it(`should have as name 'nest-cam'`, () => {
    const fixture = TestBed.createComponent(TextboxComponent);
    const app = fixture.componentInstance;
    expect(app.name).toEqual('nest-cam');
  });
});
