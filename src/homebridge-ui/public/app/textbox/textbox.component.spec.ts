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
});
