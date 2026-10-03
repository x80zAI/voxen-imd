# VOXEN IMD

An independent, English-language workspace for real IMD market data, agent seat records, published work and file integrity checks. Built for David with an original voxel landscape, violet and lime accents, a warm ivory background and a separate cube-based identity.

The four landmarks open the working tools on the page. The landscape is decorative artwork; its buildings and motion do not represent live agent positions or activity.

## Four working utilities

- **Markets:** read Ethereum pools whose base token is the exact official IMD address. Order them by reported liquidity or 24-hour volume, compare up to two pools and export the current reading as CSV. The headline price belongs to the pool with the most reported liquidity; it is not an executable trading quote.
- **Swarm seats:** read network presence and look up Identity.MD seat numbers from 0 to 1999. Optionally compare two seats by owner, presence and recorded work counts. Open their original records for further inspection. These figures describe the existing network; VOXEN does not run or hire those agents.
- **Published work:** search the official publication index, filter by category, browse its pages and open the original repository, website or job record. File records can supply an expected fingerprint to the integrity tool. The public view keeps declared contract chains on Ethereum mainnet and excludes records identified as illustrative or development-only work. The source's page totals can include records excluded from this view.
- **File integrity:** choose a file on your device and calculate its SHA-256 fingerprint. Compare it with a published fingerprint or one you paste yourself, copy the result or save a JSON record. Files up to 64 MiB are processed locally; file contents are never uploaded by this tool.

There is no staking, VOXEN token, token sale or reward contract. The site does not connect wallets, request signatures, set spending permissions or send transactions. No paid agent service or additional agent-execution backend is required.

## Data and privacy

Official IMD on Ethereum: `0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7`.

The market tool uses Dexscreener. Seat and publication tools use the official public IMD API through the site's read-only `/api/data` function. Each successful reading includes its source and fetch time. Public services may lag or become unavailable; missing values appear as unavailable, never as invented balances, prices or activity.

The file checker reads your chosen file in browser memory. Its saved JSON contains the filename, fingerprints, comparison result, source reference and check time, without the file contents. A matching fingerprint establishes identical bytes relative to that fingerprint; it does not establish that a file is safe to open. An expected fingerprint pasted manually is only as trustworthy as the place you obtained it from.

Searches and requested seat or job IDs are sent to the site's data function and the relevant public provider. External links open the original service. There is no personal archive or cross-device storage in VOXEN. Closing or refreshing the page resets your current selections; download any records you want to keep.

See [data sources and limits](docs/SOURCES.md) for the exact routes, validation and source references.

## Run locally

Use Node.js 24 and the versions in `package-lock.json`:

```sh
npm ci
npm run dev
```

Open [http://127.0.0.1:5196](http://127.0.0.1:5196). Vite also serves the read-only data route locally. No API key or wallet credential is required.

To inspect the production build locally:

```sh
npm run build
npm run preview
```

Stop the development server before starting preview on the same port. The build output is `dist`.

## Verify changes

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

Complete these checks with actual upstream readings and desktop/mobile browser checks. Test fixtures stay in the test suite and are not public website content. Automated checks do not, by themselves, confirm that GitHub or Vercel publication has completed.

## Project structure

```text
api/data.mjs       Fixed-source public reads, validation and bounded caching
src/App.tsx        The four tools and page navigation
src/lib.ts         Request state, formatting, downloads and local SHA-256
src/VoxelWorld.tsx Original interactive SVG landscape
src/style.css     Responsive layout, visual effects and reduced-motion styles
public/           Original logo and favicon
tests/            Data validation and request behavior checks
docs/SOURCES.md   Sources, reading boundaries and feature inspiration
vite.config.ts    Local development and preview data route
vercel.json       Vercel build, data function and response headers
```

## Publication

The intended GitHub repository is [x80zAI/voxen-imd](https://github.com/x80zAI/voxen-imd), and the intended Vercel address is [voxen-imd.vercel.app](https://voxen-imd.vercel.app/). **Publication is pending verification.** These are planned destinations, not a confirmation that either publication is live.

Vercel is configured for `npm ci`, `npm run build`, the `dist` output and the Node.js data function. The X account and a custom domain will be connected when David supplies them.

VOXEN IMD is independent of the official IMD team, Dexscreener and Uniswap. Source listings and recorded work are not endorsements.
