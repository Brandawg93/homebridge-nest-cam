import { TestBed } from '@angular/core/testing';
import { ProgressBarComponent } from './progress-bar.component';

describe('LoginComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [],
      declarations: [ProgressBarComponent],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(ProgressBarComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });
});
