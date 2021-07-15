export const itif = (condition: string | undefined): jest.It => (condition ? it : it.skip);

export const getRefreshToken = (): string => {
  const refreshToken = process.env.REFRESH_TOKEN;
  if (!refreshToken) {
    throw new Error('Refresh token not found.');
  }
  return refreshToken;
};
