# QuoteGate

QuoteGate helps buyers screen supplier quotes against the same budget, delivery date and scope checklist. It preserves the supplier's written terms and highlights why each quote fits, needs clarification or falls outside the request. The shortlist records an eligibility decision for the buyer to review.

## Run locally

Install Node.js 22 or newer. Extract the release, open its `QuoteGate` directory and run:

```sh
npm start
```

Open **http://127.0.0.1:4174/**. The release already contains the bundled client. To rebuild it, use `npm ci` then `npm run build`. Run `npm test` to check the demo logic.

Upload the contents of `dist/` to a static host for public access. Relative asset paths work under a GitHub Pages project path.

## Steward review

1. **Open the workspace.** Demo mode loads the **Community workshop print packs** request without a wallet.
2. **Inspect the exclusions.** Select **Bright Paper**. Its quote meets the budget and date, but the delivery checklist item is **Excluded**. Select **Stack & Stitch** for a quote with an unspecified cover-stock weight.
3. **Verify an existing GenLayer review.** Switch to **StudioNet** and open **RFQ-0001**. **Cedar Press (sample)** has a finalized **Fit** verdict. **Bright Paper (sample)** has a finalized **Out of scope** verdict and shows its delivery exclusion.
4. **Check the shortlist proof.** Select **Cedar Press (sample)**, then **View shortlist proof**. The app recomputes the SHA-256 fingerprint of the snapshot and shows whether it matches. Download the JSON for a separate check.
5. **Try a fresh request.** Connect a StudioNet wallet on chain 61999. Open a request with one requirement per line, add a test supplier quote, then select **Run scope review**. Wait for finality when signing each write. For an eligible quote, select **Shortlist quote**. Use **Copy request link** to share the live review workspace for that request.

[StudioNet contract](https://explorer-studio.genlayer.com/address/0x399ddf5935744F3B0f6a6092Eb48628D4B0F0Ae6) · [Deployment](https://explorer-studio.genlayer.com/tx/0x57c1d5de66ca1ae404f44e0b95127bb549fd8f0f80859f6c880e345c36eb38d5)

## How the contract works

- The buyer defines one currency, a budget cap, a delivery deadline, and one to eight criteria. A supplier signs the quote using the request's currency. The contract persists the original quote, the signer and a quote fingerprint.
- The contract compares whole minor-unit amounts and ISO dates directly. GenLayer validators independently classify each written requirement as `COVERED`, `EXCLUDED` or `UNCLEAR`. The ordered list of decisions must match exactly. Persisted evidence excerpts must be literal substrings of the submitted quote. The checks establish textual traceability and reviewers can read the full quote in context.
- A price or date miss or any explicit exclusion yields `OUT_OF_SCOPE`. An unresolved criterion yields `NEEDS_CLARIFICATION` when the other checks pass. Complete coverage within both limits yields `FIT`.
- Only the buyer who opened a request can run a scope review or shortlist. Shortlisting an eligible quote stores the screening snapshot and its SHA-256 fingerprint. The snapshot binds the budget, deadline, criteria, quote fingerprint and review.
- Demo reviews for new quotes are manual. The StudioNet workflow uses GenLayer consensus. The testnet contract has public records and accepts test quote submissions from any wallet, capped at 20 per request. Use fictional data. QuoteGate screens offers for buyers and does not execute a purchase.

## Verification and layout

- `contracts/quote_gate.py` contains the Intelligent Contract.
- `dist/` contains the deployable web workspace. `src/studionet.js` contains the browser wallet and RPC adapter.
- `verification/contract-schema.json` contains the schema returned by StudioNet.
- `verification/deployment.json` records the deployed source fingerprint, successful finalized transactions, two distinct review results and the verified shortlist digest.
- `scripts/deploy-studionet.mjs` documents the deployment and smoke flow. For a new deployment, work in a separate copy, move the existing `verification/deployment.json` aside, and run `node scripts/deploy-studionet.mjs --smoke` after `npm ci`. Then update `dist/config.js` with the newly verified address.
