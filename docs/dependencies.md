# Dependency decisions

The production Worker and browser page have no npm runtime dependencies.
Routing, validation, rendering, hashing, and narrowly scoped RS256 JWT
verification use platform APIs. No framework, SDK, or UI library is needed.

Development dependencies are pinned: TypeScript and Cloudflare types for
checking; Wrangler for Worker bundling, local execution and D1 migrations;
Miniflare for integration tests using the real Workers/D1 runtime; Node types
for editor support. Tests use Node's built-in runner and TypeScript stripping.
These are development-tool/type-definition exceptions under npm-policy and
add no code to the deployed Worker. Wrangler and Miniflare are pinned to the
same stable generation instead of the registry's current alpha runtime.

The package registry was checked on 2026-09-17. All selected tooling has a
release within the last six months. Cloudflare maintains Wrangler, Miniflare,
and Workers types; Microsoft maintains TypeScript; DefinitelyTyped maintains
Node types. These tools are needed as long as this is a TypeScript Worker.
No bundle-size exception is needed for development-only packages.

Use the committed lockfile and frozen installs. Only the esbuild and workerd
installation scripts are permitted. Review updates before changing these pins.
