# Agent workflow verification

Checked on 4 October 2026. Times below are UTC.

## Code checks

ESLint and the TypeScript production build passed. All 82 automated checks passed, including 22 gateway and 18 independent wallet-client checks. The remaining checks cover the public data adapter, local file verification and observation reports.

## Observation agents

The real browser generated a Market Watch report from four accepted Ethereum IMD pools at 16:08:27.447, preserving source acquisition at 16:08:27.444. Publication Watch and Network Brief recorded source unavailability at 16:08:30.866 and 16:08:30.416 respectively. These failures did not create network figures or publication records.

Watching produced eight accepted Market Watch reports at sixty-second intervals through 16:15:27.566 while the page remained visible. Stopping checks ended scheduling. The downloaded JSON history held the latest ten reports and survived a page refresh. Reports kept execution and acquisition times separately. The source-unavailable reports retained their failure status.

Desktop and 390- and 320-pixel mobile layouts were inspected. The mobile document had no horizontal overflow in the new controls. The existing market table keeps its own horizontal scroll area.

## Research requests

The actual IMD capabilities endpoint returned Ethereum mainnet research admission at 0.5 IMD and a 600-second quote lifetime. A real research brief passed the official brief check with no blockers. A free quote returned HTTP 201. The same browser order was recovered after correcting preparation validation, showed the 0.5 IMD price and expiry, and its official status read returned `quoted`. The service adds an empty `contracts` array when preparing research input; the client and gateway accept only that narrow normalization and reject changed objectives, outputs or contract requests.

The client persists order recovery before requests, binds the returned quote to the exact prepared input and verifies the chain, token, recipient, price and expiry. Permission is limited to the quoted IMD amount. Payment requires explicit visitor wallet actions. Pending and admitted orders are reconciled before a manual retry; a lost response keeps the same order and payment bytes. Admission and a completed, fingerprinted report remain separate states.

No wallet was connected during development verification. No allowance, payment signature, paid admission or completed research job was executed. Offline checks of the payment boundaries do not certify settlement with funds or the quality of an IMD report. The service's current availability may change.

## Scope

Observation reports run while the page is open and visible; the website does not operate unattended cloud monitors. Research requests use the official IMD service and the visitor's Ethereum wallet. There is no staking, VOXEN token, autonomous payment or contract-launch feature.
