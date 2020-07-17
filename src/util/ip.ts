import os from 'os';

export function getAddresses(family = 'ipv4'): Array<string> {
  family = family.toLowerCase();

  const interfaces = os.networkInterfaces();

  const keys = Object.keys(interfaces);
  keys.forEach((key) => {
    // Remove all virtual interfaces
    if (key.startsWith('v')) {
      delete interfaces[key];
    }

    // Remove all bridge interfaces
    if (key.startsWith('br')) {
      delete interfaces[key];
    }
  });

  // Combine all interfaces to single list
  const vals = Object.values(interfaces);
  let all: Array<os.NetworkInterfaceInfo> = [];
  vals.forEach((val) => {
    val && (all = all.concat(val));
  });

  // Remove addresses that have incorrect family or are internal
  const addresses = all.filter((details) => {
    const fam = details.family.toLowerCase();
    return fam === family && !details.internal;
  });
  return addresses.map((x) => x.address);
}
