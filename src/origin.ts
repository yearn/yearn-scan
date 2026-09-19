const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

export function isAllowedOrigin(request: URL, configuredOrigin: string): boolean {
  if (request.origin === configuredOrigin) return true;
  const configured = new URL(configuredOrigin);
  // Local aliases are equivalent only when the configured origin is itself
  // loopback HTTP. Production HTTPS origins still require an exact match.
  return configured.protocol === 'http:' && request.protocol === 'http:'
    && loopbackHosts.has(configured.hostname) && loopbackHosts.has(request.hostname)
    && request.port === configured.port;
}
