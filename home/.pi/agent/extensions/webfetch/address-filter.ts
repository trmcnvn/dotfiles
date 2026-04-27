import { BlockList, isIP } from "node:net";

type IpFamilyName = "ipv4" | "ipv6";

const NON_GLOBAL_IPV4_SUBNETS = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const;

const NON_GLOBAL_IPV6_ADDRESSES = ["::", "::1"] as const;

const NON_GLOBAL_IPV6_SUBNETS = [
  ["::", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 32],
  ["2001:2::", 48],
  ["2001:10::", 28],
  ["2001:20::", 28],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const;

const createNonGlobalIpBlockList = (): BlockList => {
  const blockList = new BlockList();

  for (const [address, prefix] of NON_GLOBAL_IPV4_SUBNETS) {
    blockList.addSubnet(address, prefix, "ipv4");
  }

  for (const address of NON_GLOBAL_IPV6_ADDRESSES) {
    blockList.addAddress(address, "ipv6");
  }

  for (const [address, prefix] of NON_GLOBAL_IPV6_SUBNETS) {
    blockList.addSubnet(address, prefix, "ipv6");
  }

  return blockList;
};

const NON_GLOBAL_IP_BLOCK_LIST = createNonGlobalIpBlockList();

export const normalizeHostname = (hostname: string): string => {
  const normalized = hostname.trim().toLowerCase().replace(/\.+$/, "");
  return normalized.startsWith("[") && normalized.endsWith("]")
    ? normalized.slice(1, -1)
    : normalized;
};

const ipFamilyName = (address: string): IpFamilyName | null => {
  const ipVersion = isIP(address);
  if (ipVersion === 4) return "ipv4";
  if (ipVersion === 6) return "ipv6";
  return null;
};

export const isNonGlobalAddress = (address: string): boolean => {
  const normalizedAddress = normalizeHostname(address);
  const family = ipFamilyName(normalizedAddress);
  // Passing the parsed family lets BlockList match canonical IPv4-mapped IPv6
  // addresses like ::ffff:7f00:1 against the IPv4 subnet rules above.
  return family === null ? false : NON_GLOBAL_IP_BLOCK_LIST.check(normalizedAddress, family);
};

export const isBlockedHostname = (hostname: string): boolean => {
  const normalizedHostname = normalizeHostname(hostname);
  return (
    normalizedHostname === "localhost" ||
    normalizedHostname.endsWith(".localhost") ||
    normalizedHostname.endsWith(".local") ||
    normalizedHostname.endsWith(".localdomain") ||
    isNonGlobalAddress(normalizedHostname)
  );
};
