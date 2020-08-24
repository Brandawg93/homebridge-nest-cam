export function encrypt(text: string) {
  const buff = new Buffer(text);
  return buff.toString('base64');
}

export function decrypt(text: string) {
  const buff = new Buffer(text, 'base64');
  return buff.toString('ascii');
}
