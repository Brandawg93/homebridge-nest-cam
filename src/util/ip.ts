import os from 'os';

export function getIpAddresses(family = 'ipv4'): Array<string> {
  const interfaces = os.networkInterfaces(),
    familyLower = family.toLowerCase();

  return Object.entries(interfaces).reduce((addresses, [key, interfaceInfos]) => {
    // Skip all virtual and bridge interfaces
    if (key.startsWith('v') || key.startsWith('br')) {
      return addresses;
    }

    const matchingAddresses = (interfaceInfos || []).reduce((matches, interfaceInfo) => {
      // Remove addresses that have incorrect family or are internal
      if (interfaceInfo.internal || interfaceInfo.family.toLowerCase() !== familyLower) {
        return matches;
      }

      return matches.concat([interfaceInfo.address]);
    }, [] as Array<string>);

    return addresses.concat(matchingAddresses);
  }, [] as Array<string>);
}
