export const SERVICE_UUID = '8be12000-7e34-4b80-8fd8-7277a721e9bc';
export const TX_UUID = '8be12001-7e34-4b80-8fd8-7277a721e9bc';
export const RX_UUID = '8be12002-7e34-4b80-8fd8-7277a721e9bc';

export const toBytes = (text: string) => Array.from(text, (c) => c.charCodeAt(0) & 0x7f);
export const fromBytes = (bytes: number[]) => String.fromCharCode(...bytes);

export function configVersion(value: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, '0');
}

export function pairingLink(server: string, token: string) {
  return `loomcare://gateway-pair?server=${encodeURIComponent(server)}&token=${encodeURIComponent(token)}`;
}

export function parsePairing(text: string): { server: string; token: string } | null {
  const field = (name: string) => {
    const match = text.trim().match(new RegExp(`[?&]${name}=([^&#\\s]+)`));
    return match ? decodeURIComponent(match[1]) : null;
  };
  const server = field('server'), token = field('token');
  if (!server || !token || !/^https?:\/\/[^\s]+$/.test(server) || token.length < 20 || token.length > 200) return null;
  return { server: server.replace(/\/$/, ''), token };
}
