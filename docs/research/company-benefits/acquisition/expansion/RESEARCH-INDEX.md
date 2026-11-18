# Expansion research index v1 (audit only)

The restricted private `research-index.v1.jsonl` appends provenance for the 71 **new** v1/v2 identity candidates from 13 restricted research shards. It does not modify the frozen 2,000-company population, identity ledgers, benefit cards, or site. Its 691 rows are raw research observations, **not** distinct or independently approved benefits; approved count remains zero. A company row contains ordered private observation line references and whole-row SHA-256 digests, exact raw count, and only HTTPS source locators present in observation rows. HTTP-only observations are represented by hashes and counts without exposing an insecure URL. No private quotes, statements, response bodies, input paths or credentials are copied. All scope/rights remain research-only and unreviewed; employer/payroll entity, currentness, eligibility and quotation permission still require independent review.

The restricted private `research-inputs.v1.json` pins all three files in every private shard, ordered legal names/IDs and row totals, plus both private identity ledgers. The compiler checks the producer manifest's actual digest and total spellings explicitly: `kr-0` uses `outputs_sha256`; `kr-2` uses structured `files` with row and byte counts and no aggregate observation total; all other shards use `files_sha256`. Only `us-second-1` uses `observations_count`; all other aggregate declarations use `observation_count`. For observation/coverage legal names, `us-second-0`, `us-second-3`, and `us-second-4` use `sec_official_name`, and `us-second-1` uses `sec_legal_name`; all others use `legal_name`. Missing coverage counts may only be derived from pinned observations when producer totals and coverage cardinality agree. No aliases are inferred at runtime.

From repository root, with the restricted private root available:

```sh
python3 docs/research/company-benefits/acquisition/expansion/research_index.py check \
  --input-root ${HERMES_HOME}/data/benefit-batch-wave/expansion-research
EXPANSION_RESEARCH_INPUT_ROOT=${HERMES_HOME}/data/benefit-batch-wave/expansion-research \
  python3 -m unittest discover -s docs/research/company-benefits/acquisition/expansion -p 'test_research_index.py' -q
```

`compile` regenerates only the audit index from *exactly* pinned private bytes; never use it to silently repin a changed producer bundle. Changes require a new version/provenance review. The index and identity files are private while reuse rights remain undecided; only aggregate counts and hashes are published. No source locator constitutes approval or a live directory entry.
