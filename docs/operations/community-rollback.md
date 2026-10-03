# Community rollback and forward recovery

Rollback preserves data first. Database migrations are forward-only and additive. There is **no destructive down migration** and no destructive rollback. Preserve the encrypted backup, private Storage inventory, release evidence, approval records, failing revision, and logs before changing anything.

## Mandatory order

For a release incident, use this order exactly:

1. **Disable writes and the backend mutation surface first.** Put the community in maintenance/read-only mode; disable write-capable Edge Functions/routes and scheduled mutation jobs without blocking public reads needed for diagnosis.
2. Capture UTC incident time, revision, first failing check, affected project-ref hash, current migration state, and backup/evidence references.
3. **Rollback Pages from a known-good source commit through the existing workflow.** Revert the bad source commit without rewriting history, run the full gate for the revert revision, and deploy only through `.github/workflows/jekyll.yml`.
4. **Forward-fix the database.** Do not delete an applied migration, run a down migration, or restore old data merely to match old frontend code.
5. If integrity is not recoverable by forward-fix, restore to a clean target using [the Free Plan recovery procedure](community-backup-restore.md), verify, and cut over only with separate approval.
6. Re-enable writes and schedules only after read-only probes, approved canary cleanup/read-back, and observation are green.

In one sentence: disable writes/backend mutation surface first, rollback Pages from a known-good source commit/workflow, then forward-fix the DB.

## Write-disable stop point

A designated incident lead approves `INCIDENT_WRITE_DISABLE_APPROVAL`. Exact switches depend on the already-reviewed maintenance implementation; do not improvise SQL grants or delete Functions during an incident. Confirm from an anonymous browser and the dedicated test identity that reads remain available and every write route fails closed. Pause `.github/workflows/community-snapshots.yml` if transient or inconsistent data could be published.

```bash
: "${INCIDENT_WRITE_DISABLE_APPROVAL:?record incident write-disable approval}"
: "${GITHUB_REPOSITORY:?set owner/repository}"
gh workflow disable community-snapshots.yml --repo "$GITHUB_REPOSITORY"
gh workflow view community-snapshots.yml --repo "$GITHUB_REPOSITORY"
```

If the write-disable control is absent or cannot be verified, stop the release and escalate. Do not attempt a destructive schema reversal.

## Source-driven Pages rollback

Select the last known-good commit using its successful release evidence, not appearance alone. Create a normal revert commit on the deployment branch; do not force-push or rerun the same bad artifact.

```bash
: "${KNOWN_GOOD_COMMIT:?set the evidence-backed source commit}"
: "${BAD_RELEASE_COMMIT:?set the release commit to revert}"
git show --no-patch --format='%H %cI' "$KNOWN_GOOD_COMMIT"
git show --no-patch --format='%H %cI' "$BAD_RELEASE_COMMIT"
git revert "$BAD_RELEASE_COMMIT"
node scripts/release-gate.mjs --mode local \
  --evidence "${ROLLBACK_EVIDENCE_PATH:?set an external evidence path}"
printf '%s\n' 'STOP: obtain Pages rollback deployment approval'
```

After `PAGES_ROLLBACK_APPROVAL`, use only the repository’s existing `jekyll.yml` source workflow. The approver verifies the revert commit SHA in the workflow run before deployment. Then verify canonical routes, community shells, snapshots/sitemap, assets, OAuth callback behavior, and read-only Supabase access. The release gate itself never invokes Pages deployment.

## Database forward-fix

If data integrity is intact, make a new additive migration from the observed production state. Reproduce and test locally, run Task 16 E2E, then hosted development integration and exact fixture cleanup. Take a new encrypted logical backup and private Storage inventory before production.

**Production forward-fix stop point:** require a reviewed migration and `PRODUCTION_FORWARD_FIX_APPROVAL`.

```bash
: "${PRODUCTION_PROJECT_REF:?set production project ref}"
: "${PRODUCTION_FORWARD_FIX_APPROVAL:?record forward-fix approval}"
read -rsp 'Production database password: ' SUPABASE_DB_PASSWORD
printf '\n'
export SUPABASE_DB_PASSWORD
./community-app/node_modules/.bin/supabase --workdir "$(git rev-parse --show-toplevel)" \
  db push --project-ref "$PRODUCTION_PROJECT_REF" --dry-run
printf '%s\n' 'STOP: compare dry run to the approved additive forward-fix'
```

Apply only after a second confirmation, then unset the password, run read-only probes, and retain write-disable until the separately approved bounded canary has exact cleanup/read-back.

## Clean-target recovery

When corruption or incompatible state requires recovery, do not restore over production by default. Follow the encrypted logical restore runbook. Under Free active-project capacity, pause development before creating or activating a clean recovery project. Never repurpose production as development and never offer PITR, project clone, managed restore-to-new-project, temporary paid upgrade, or paid overage as a Free Plan fallback.

Restore Storage object bytes separately, reconfigure OAuth/Auth/keys/Functions/extensions/schedules/network settings, and compare private inventory counts and checksums. Preserve the old production target until the recovery and rollback windows close.

## Re-enable and close

After correction:

1. run production read-only probes;
2. obtain separate write-canary approval;
3. record deterministic canary prefix/UUID and exact fixture IDs;
4. clean only exact IDs and prove zero-residue read-back;
5. restore snapshot scheduling and observe at least one successful run;
6. re-enable the backend mutation surface under incident-lead approval;
7. publish the incident record without secrets or user content.

```bash
: "${INCIDENT_RECOVERY_APPROVAL:?record recovery approval}"
: "${GITHUB_REPOSITORY:?set owner/repository}"
gh workflow enable community-snapshots.yml --repo "$GITHUB_REPOSITORY"
gh workflow view community-snapshots.yml --repo "$GITHUB_REPOSITORY"
```

## Official references

- Supabase CLI backup/restore: https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
- Supabase Functions deployment: https://supabase.com/docs/guides/functions/deploy
- GitHub Pages custom workflows: https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
- GitHub Actions deployments: https://docs.github.com/en/actions/deployment/about-deployments/deploying-with-github-actions
