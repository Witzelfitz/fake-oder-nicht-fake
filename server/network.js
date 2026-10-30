import { networkInterfaces } from 'node:os';

export function localAddresses(port, reader = networkInterfaces, warn = console.warn) {
  try {
    return Object.values(reader()).flat().filter(x => x?.family === 'IPv4' && !x.internal)
      .map(x => `http://${x.address}:${port}`);
  } catch {
    warn('Netzwerkadressen nicht verfügbar. Konfigurierte Adresse oder lokalen Fallback verwenden.');
    return [];
  }
}
