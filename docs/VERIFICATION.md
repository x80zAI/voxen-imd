# Delivery verification

Checked on 4 October 2026, Europe/Madrid.

Production: https://voxen-imd.vercel.app/

Source: https://github.com/x80zAI/voxen-imd

## Code and publication

`npm run lint`, `npm run typecheck`, `npm test` and `npm run build` passed after the final application change. All 29 automated checks passed. A separate final review found and resolved a pool-comparison edge case: refreshing markets now clears the previous selection, so a removed pool cannot leave the comparison blocked.

The application revision `4fddb650caa16ccc79ecdf84a9a725c55bab938d` was checked file by file against the local source using SHA-256. Vercel reported its production deployment ready, with `voxen-imd.vercel.app` assigned to it. Subsequent delivery-documentation commits do not change application behavior.

The public page returned HTTP 200. Its HTML, JavaScript, CSS, logo and favicon matched the local production build. Content security, content-type and referrer-policy headers were present. The Vercel project is linked to the repository's `main` branch.

## Working tools

- Market data loaded from the exact official Ethereum IMD address. The two-pool selection limit, comparison reset on refresh and CSV export were checked. The exported CSV contained four real source pools and the source reading time.
- Seats 42 and 0 were looked up and compared through the production page. The cards preserved online and offline presence separately and showed the source counts. One initial upstream read was temporarily unavailable; the page displayed that failure and the repeated query succeeded.
- Publication search for Ethereum, category filtering for code, original record links, file-record selection and navigation to the second source page were checked with real records.
- The actual 3,754-byte official artifact from job `9ba0e6d1-f90f-46fe-b0a9-2851b0b45c94` matched its published SHA-256 in the production browser. Changing the expected fingerprint produced a mismatch during local browser verification. The downloaded JSON result was checked against the selected file and its exact digest. The file itself remained in the browser; the tool has no file-upload request.

Production data routes returned successful, timestamped readings for markets, swarm, seat zero, publication search and the official artifact record. Invalid seat IDs, unrecognized query parameters and duplicate parameters returned HTTP 400. POST returned HTTP 405. Those error responses used `no-store` caching.

## Presentation and scope

The desktop layout and mobile widths of 390 and 320 pixels were inspected. The mobile document had no horizontal page overflow; the market table retains its own horizontal scrolling. The original voxel landmarks link to the corresponding utilities, and the public interface is in English.

The product has no staking feature. It uses public data and local file hashing, without a paid agent service. The decorative island does not claim to depict live agent positions. Source availability and recorded values can change after these checks.

David's X account and custom domain are awaiting the addresses he will provide.
