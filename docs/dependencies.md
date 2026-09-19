# Dependency decisions

The approved migration uses vinext App Router, React, React DOM and React Server
Components. These provide the requested routing conventions, server rendering
and interactive components. Tailwind compiles utility classes into static CSS;
there is no additional UI component library or client SDK. Validation, JWT
verification and D1 queries still use our existing code and platform APIs.

Registry and upstream documentation were checked on 2026-09-19. vinext is an
actively maintained Cloudflare project in beta, with compatibility gaps; its
framework choice was explicitly approved for this migration. React is actively
maintained by Meta and contributors. Both are long-term application architecture
dependencies rather than replaceable utilities. vinext exposes ESM entry points;
React also includes CommonJS runtime code, so tree shaking alone does not remove
its framework cost. All direct versions are pinned and respect the seven-day
release-age policy. vinext beta.9 is the latest release meeting that cutoff.

Bundlephobia could not build vinext. Its React/React DOM root-entry estimates
(8.0/4.0 kB minified) omit the client renderer and RSC runtime and are not useful
as application totals. The completed production client build contains 452 kB of JavaScript
(137 kB summed gzip) and 12.3 kB of CSS (3.5 kB gzip). This is an intentional size increase
for the approved framework migration; measure the final application build when
updating these dependencies. The server bundle includes separate RSC and SSR
chunks and is not sent to browsers.

Development-only packages include Vite, its Cloudflare/React/RSC plugins,
Tailwind and its Vite plugin, Wrangler, Miniflare, TypeScript, type definitions
and Playwright. These are the npm-policy tooling/type exceptions. Cloudflare,
Vite, Tailwind, Microsoft and DefinitelyTyped maintain their respective tools.
Wrangler 4.131.1 uses Cloudflare's bundled Miniflare 5 alpha internally; our
integration harness uses the stable Miniflare 4 API. Both execute actual workerd
and D1 rather than mocking database behavior.

Use frozen installs. Only esbuild and workerd installation scripts are allowed.
Review dependency updates and run both API and browser tests before changing
pins. Framework upstream: https://github.com/cloudflare/vinext
