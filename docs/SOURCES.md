# Data sources and reading limits

VOXEN IMD reads public records, generates observation reports, verifies locally selected files and provides visitor-controlled research-job requests. Observation reports are rule-based computations over acquired data. Responses attributed to IMD jobs must come from the official service.

## Official token identity

The [official IMD token page](https://imd.fun/token/) publishes this Ethereum address:

`0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7`

[Etherscan token record](https://etherscan.io/token/0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7).

This is the external IMD token used to identify source data. VOXEN has no token or token contract. Names and symbols alone are not identity checks: another token can use the symbol `IMD`.

## Market reads

Provider: [Dexscreener API documentation](https://docs.dexscreener.com/api/reference).

The implemented upstream route is:

```text
GET https://api.dexscreener.com/latest/dex/tokens/0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7
```

This route returns an object with a `pairs` array. The server accepts only Ethereum rows with the exact official IMD address as `baseToken.address`. An IMD quote-token pool is excluded because its `priceUsd` describes the other base token.

Each displayed row uses the source's pair ID, DEX, quote symbol, USD price, reported USD liquidity, 24-hour volume, price change, buy/sell counts and original Dexscreener link. Invalid or missing numeric fields remain `null`. Duplicate pool IDs are removed. Up to 100 matching source rows are considered.

Uniswap v4 IDs may be 32-byte pool identifiers rather than 20-byte contract addresses. VOXEN preserves the provider's pool link instead of inventing an Etherscan address URL. The headline uses the greatest reported liquidity in the returned pool list. It is a snapshot of provider data, without transaction preparation, slippage calculation or an executable price guarantee.

The CSV includes the fetch time and source pool links. Missing figures produce empty cells; they are not converted to zero. Text cells that spreadsheet software could interpret as formulas are escaped.

## Agent and seat reads

Source: [official IMD API documentation](https://imd.fun/docs/).

```text
GET https://api.imd.fun/swarm
GET https://api.imd.fun/workers?fields=seat%2Cworking%2Cskills%2ClastHeartbeatAt
GET https://api.imd.fun/seats/<seatId>?work=20&reviews=0
```

Network counters come from the source's `health` fields. Connected-worker records are validated separately. A failed worker read does not turn into an empty, supposedly verified network.

Seat IDs are restricted to this interface's supported Identity.MD collection range, 0 through 1999. A seat read must return the requested token ID and a work-record array. Owner addresses, boolean presence and integer counters are checked before use. Valid work entries preserve their job IDs and submitted time; the source's counts describe the whole record, while the retrieved work list is bounded.

The official API can return `404 unknown_seat` when no device has paired with that token. This is different from an offline seat and different from a failed provider read. Work acceptance and presence are source records, not promises of skill, safety, availability or profitability.

## Publication and file records

```text
GET https://api.imd.fun/publications?q=<search>&type=<category>&page=<page>&pageSize=12&sort=newest
GET https://api.imd.fun/jobs/<jobId>/result
```

Queries are restricted to 200 characters, approved categories and bounded page numbers. Publication and job responses must have the expected shape and matching requested IDs/page. The official index can group continuations of one project; the application preserves recorded repository and commit metadata and links to the job, repository and named site when available.

The public list requires declared contract chains to be Ethereum mainnet, chain ID 1, and excludes titles identified as illustrative or development-only work. Real code, research and media can have no contract-chain metadata. Missing chain metadata does not certify where an external application executes. Original page counts and pagination remain those of the source index; the visible list can therefore contain fewer than 12 records or no eligible record on a page.

An empty successful search is a valid response. It is not replaced with preloaded records. Statuses such as blocked or pending remain distinct from completed work. A missing status remains unavailable.

Repository links are limited to HTTPS on GitHub. Site links use a validated named label on the official `sites.imd.fun` gateway. Artifact links are derived only from valid 64-character hashes on `api.imd.fun`. Incoming content is displayed as text; source records do not provide executable page markup.

## Local SHA-256 comparison

The official API's **Bundles and artifacts** documentation identifies raw artifact bytes by SHA-256. A published media file or job result can provide `hash`, `bytes`, `name`, `mediaType` and its artifact URL.

The integrity tool uses the browser's Web Crypto SHA-256 function on the exact selected bytes. The limit is 64 MiB, or 67,108,864 bytes. A missing or invalid published hash cannot establish a comparison. The visitor may instead paste a valid expected fingerprint; its source is then the visitor's responsibility.

The file is not sent to `/api/data` or to IMD. The downloadable JSON contains metadata and the result, without the file contents. A match verifies byte equality against the expected digest. It does not verify a creator's identity, file safety, contract behavior or an audit.

During source research, the real artifact for job `9ba0e6d1-f90f-46fe-b0a9-2851b0b45c94` was read and hashed in memory. Its 3,754 bytes matched the published SHA-256 `dcb08e7d13923b139b717bb30cb3ac967328dd3de155d385426339d1a7854907`. This record is verification evidence, not a prefilled visitor file.

## Application route, caching and failures

The site's GET-only `/api/data` route selects a fixed upstream based on `kind=market`, `swarm`, `seat`, `publications` or `job`. Visitor input never chooses an upstream host or HTTP method. This reading route is separate from `/api/requests`, which supports the official research-job request protocol.

Upstream reads have a 9-second timeout and a 2 MiB response-size bound. Redirects, non-JSON responses, unsuccessful HTTP responses and invalid payloads are rejected. At most 96 successful cache entries are kept per running function instance for 30 seconds. Identical concurrent reads share one request; different queries have separate entries. Successful responses permit 20 seconds of Vercel shared caching, and error responses are not cached by the application.

`fetchedAt` records when VOXEN obtained a successful source response. It does not prove when a provider last indexed the underlying market or network. Cached responses keep that timestamp. The original tools read on load and on lookup, search or refresh. The separate Agent workspace supports sixty-second observations while the page is open and visible, with execution time and acquisition time recorded separately.

## Research-job requests

Primary source: [IMD paid-request documentation](https://imd.fun/docs/#paid-requests) and the current `GET https://api.imd.fun/requests/capabilities` response. The gateway fixes all requests to the official host and supports only `job.open` with the `research-report` skill, five required citations and a Markdown report at `artifacts/report.md`. It excludes contract launches and repository delivery.

Brief checking does not create a paid job. Quotes require a request key and a client-generated request token. Payment uses the official x402 v2 Permit2 payload plus a quote-specific approval signed by the same Ethereum wallet. The visitor reviews the amount, recipient and expiry and explicitly confirms payment. Request status and job completion are separate source outcomes. Failed or delayed responses cannot establish a completed job.

Request tokens are recovery credentials for the current device; wallet secrets remain with the wallet. Orders and signed-payment attempts must retain their identifiers for retries. The gateway does not cache private request data or autonomously retry a payment. The research-job tool depends on official payment admission, available agent capacity and result delivery.

HTTP 400 means invalid input, 404 means the source has no record for the requested ID, 405 rejects methods other than GET, and 503 means a required source could not be read or validated. Unknown metadata remains unavailable. Failed readings do not become invented zero values or completed work.

The official IMD documentation currently specifies 120 public reads per minute per IP and a 10-second upstream cache for `/swarm`. Free public services can change their limits or availability. Vercel's read-only function avoids relying on browser cross-origin access to the selected providers.

## Feature-pattern references

- [Uniswap Explore](https://support.uniswap.org/hc/en-us/articles/9818094509453-How-to-use-the-Uniswap-Explore-page): pool discovery, filters and liquidity/volume sorting informed the market comparison tool.
- [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004): agent discovery and recorded reputation informed the seat comparison. VOXEN displays IMD's existing records and does not create an additional reputation registry or score.
- [Etherscan verification types](https://info.etherscan.com/types-of-contract-verification/): matching evidence with clearly stated limits informed the file-comparison explanation. VOXEN's byte comparison is not Etherscan contract verification.

These references informed utility patterns. VOXEN's layout, logo and voxel artwork are original, and no affiliation is implied.
