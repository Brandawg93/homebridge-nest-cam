export class APIError extends Error {
  public code: number;
  
  constructor(message: string, code: number) {
    super(message); // (1)
    this.name = "APIError"; // (different names for different built-in error classes)
    this.code = code;
  }
}
