import { TestBed } from '@angular/core/testing';
import { LoginComponent } from './login.component';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';

describe('LoginComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FormsModule, ReactiveFormsModule],
      declarations: [LoginComponent],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(LoginComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });
});
