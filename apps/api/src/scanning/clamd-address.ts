import { BlockList, isIP } from 'node:net';

const privateAddresses = new BlockList();
privateAddresses.addSubnet('10.0.0.0', 8, 'ipv4');
privateAddresses.addSubnet('172.16.0.0', 12, 'ipv4');
privateAddresses.addSubnet('192.168.0.0', 16, 'ipv4');
privateAddresses.addSubnet('127.0.0.0', 8, 'ipv4');
privateAddresses.addSubnet('fc00::', 7, 'ipv6');
privateAddresses.addAddress('::1', 'ipv6');

/** Literal addresses prevent DNS rebinding; clamd TCP has no authentication or encryption. */
export function isPrivateScannerAddress(address: string): boolean {
  if (address.includes('%')) return false;
  const family = isIP(address);
  return family !== 0 && privateAddresses.check(address, family === 4 ? 'ipv4' : 'ipv6');
}
