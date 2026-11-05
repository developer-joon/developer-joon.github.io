# Domestic-33 integration compatibility record

Domestic-33 advances the canonical series from 26/80 (6,500 cells) at
`cbbec09096906c8554993df37a6afa73bfa30023` to 27/80 (6,750 cells).
The retry review found Critical 0 and Important 0. No validator code or gate changed.

The prepared promotion refreshed 25 legacy DART metadata sources, causing collisions
with the same IDs in the frozen repository source registry. The compatibility input
uses the complete frozen source and gap records byte for byte. Only source
`checked_at` and `access_observation` differ from the prepared compiler input.
The legacy checks project those frozen access observations using the prepared
workflow chronology. They are compatibility checks, not new HTTP observations.
The rebuilt source audit preserves the original live observations separately and
labels each retained projected check explicitly. Existing reviewer identity and
chronology come from the prepared review; the Codex retry revalidates the projection
and does not claim a newly commissioned independent review.

The standard collision gate validates every overlapping raw legacy JSONL record.
No records are removed from the research root for promotion or integration.
Integration writes only the v2 ledgers and progress; all five legacy ledger hashes
remain unchanged. The six promoted v2 ledger files exactly match the prepared
promotion bytes. Their records exactly match the portable package; the existing
compiler canonicalizes attempt and reference order.

Validation includes portable SHA256SUMS, current standard and strict prepromotion
capture closure, prior-audit applicability, exact six-ledger preservation, absence
of receipt/raw-response hash collisions with v2 source content hashes, repeated
byte-identical compilation/promotion, explicit 26→27 dry run, and actual integration
in a separate copy. The workspace integration matches that copy byte for byte.
The final workspace ledger verifier passed. The bounded regression run passed
76 package, batch-contract, and collision tests plus 14 capture-closure tests
(90 total). `git diff --check` passed. Both freeze and effective-selection
receipts remain external and unchanged.

External retry artifacts are under
`/home/bread/.hermes/profiles/conan/cache/scratch/codex-domestic33-retry`.
Reproduce preparation with `rebuild.py`, followed by `finalize-audit.py`, against
the clean baseline above. Both use the original prepared package and portable
source package without network refreshes or changes to their files.

| Retry artifact | SHA-256 |
| --- | --- |
| `formal-review-approval-receipt.json` | `06419db5391785a7d1a76cd5da520a5258dd8b587857b04e679fa0ed01795ff7` |
| `immutable-legacy-projection-audit.json` | `7a22c27f2ece1dbec1361e555f8088e3d0061353b746adddb6c5643a204fc7be` |
| `post-review-source-audit.jsonl` | `216ea77ae07b0662c74847fc7290eef323ed8f807cada19d1be2cf8ec2ae6f2f` |
| `prior-audit-applicability.json` | `1f8bede4699a310ddb7d696e4ac894eab10374da6fc1eba4e469fda53492b211` |
| `promoted/batch.json` | `8b640a8a4c30c778c43f3f69022d7b49106ea521081f809f1c368e75b2fee40c` |

Immutable repository legacy ledger hashes before and after integration:

| Ledger | SHA-256 |
| --- | --- |
| `benefit-claims.jsonl` | `6d09619761f4fad49b9d2d78dfe818f5401f8dac65b4c0cd7941841ce156dd0b` |
| `reviews.jsonl` | `20ce3de08492ebd251451c355c46cf2ec65e5104e4e60a7d166a6b9270ad1b7b` |
| `series-prepublication-checks.jsonl` | `621eaa52ce1d886ae3ac1aa92d3bf882f66323554751abb86c133c7849a76053` |
| `series-research-gaps.jsonl` | `c46d47c815492ebd0956767b6736dc400880763980e0e611e014209d09e2402a` |
| `source-registry.jsonl` | `0ede865aa8e4621188b0910c6a4c7c842628f37e3be00ff0f1c7fffe8a5643a2` |
