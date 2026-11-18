# Third official-source wave: domestic-09, domestic-10, domestic-11

This is a **local audit-only inventory**, separate from `official-wave/`, `official-wave-next/`, verified ledgers and public content. The exact 75 selected employers have 295 private producer observation rows (134/111/50) across 28 employers (10/11/7); 47 employers remain `research_incomplete` (15/14/18). Research incomplete **does not establish absence**. Rows are neither independently deduplicated propositions nor approved benefits. **Approved benefits: 0.**

Each projected lead retains the exact company ID/name, HTTPS source URL when available, category hint, private batch and one-based row pointer, SHA-256 digests of its private statement and scope note, and unreviewed rights status. Statements, quotes, scope text, response bodies and private absolute paths are not projected: quote permission and faithful paraphrase have not been adjudicated. Do not use the category hint as a benefit description. Three producer locators use unencrypted HTTP; their exact strings remain only in private inputs. Projected leads replace those source URLs with null and SHA-256 digests, mark transport `http_research_only_unpublishable`, and are not claim-eligible. Coverage removes these destinations and records hashes and a transport reason; the manifest lists only their hashes. No HTTPS counterpart is inferred. Source rights, transport, legal-entity scope, currentness and eligibility need independent review.

`manifest.json` separately preserves the pinned `international-04` legal-employer identity audit: of 29 previously unbound rows, four (observation rows 4, 14, 26, 27) are newly exact-entity-bindable, 25 remain unbound, and three were previously proven. Its compact per-company records retain exact source URLs, classification and row partitions, but no source quotations or benefit approval. Identity binding is not evidence that a benefit proposition is current, eligible or approved. This correction does not mutate the second-wave projection; later review must reconcile both states.

The rebuild checks pinned private input SHA-256s, producer manifest digests, the exact 25-ID canonical coverage and legal names per batch, disjointness, observation counts, outcomes, URL credential safety, research-only review flags, the identity-audit SHA-256 and its row partition. With restricted producer inputs available, run:

```sh
python3 docs/research/company-benefits/acquisition/normalize_official_wave_third.py --input-root "$PRIVATE_INPUT_ROOT" --check
python3 docs/research/company-benefits/acquisition/test_official_wave_third.py
```

Omit `--check` only to regenerate the three files in this directory. Neither command reaches the network, approves a benefit, or changes public output.
