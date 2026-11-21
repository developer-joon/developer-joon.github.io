# Benefit title upgrade fixtures

`benefit_title_upgrade.sh` rehearses migration `202611210003` in three uniquely
named databases inside the running local Supabase PostgreSQL cluster. It applies
the actual `202611210001` and `202611210002` migration files before each
scenario, then runs the positive rewrite, blocked concurrent-writer, and
fail-closed rollback cases. It never resets or applies fixture SQL to the
primary `postgres` database.

`prerequisites.sql` contains only database-local prerequisites that predate
migration 001 in production: the `private`, `extensions`, and migration-ledger
schemas, `pgcrypto`, and minimal `profiles` and `rate_limit_rules` relation
shapes referenced by migration 002. Supabase API roles remain cluster-global
and are not recreated.

Run the harness after `supabase start`:

```bash
npm --prefix community-app run db:test:benefit-title-upgrade
```

Run its isolation regression probes separately from frontend checks:

```bash
npm --prefix community-app run db:test:benefit-title-upgrade-isolation
```

The probe exercises successful, injected-failure, and `TERM` cleanup; rejects
unsafe database names; checks for leaked databases/sessions; and verifies that
a digest of the primary migration ledger, public catalog, and public table rows
is unchanged.
