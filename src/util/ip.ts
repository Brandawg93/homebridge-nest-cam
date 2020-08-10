import os from 'os';
import { networkInterfaceDefault } from 'systeminformation';

export async function getDefaultIpAddress(): Promise<string | undefined> {
  const interfaces = os.networkInterfaces(),
    defaultInterfaceName = await networkInterfaceDefault(),
    defaultInterface = interfaces[defaultInterfaceName],
    externalInfo = defaultInterface?.filter((info) => !info.internal),
    addressInfo = externalInfo?.find((info) => info.family === 'IPv4') || externalInfo?.[0];

  return addressInfo?.address;
}
