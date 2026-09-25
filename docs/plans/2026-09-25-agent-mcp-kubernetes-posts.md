# September 2026 Technical Posts Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Publish-ready Korean drafts for seven independent AI agent, MCP security, and Kubernetes posts on one feature branch.

**Architecture:** Each post is a self-contained Jekyll Markdown document following the repository's existing front matter and long-form operational analysis style. Research is grouped by domain, but every post has its own claim-to-source chain and deterministic cover-image seed. Validation combines source checks, structural checks, Jekyll build output, and Git remote verification.

**Tech Stack:** Jekyll 3.8.5, Kramdown, Markdown/YAML front matter, Ruby/Bundler, Git/GitHub CLI

---

### Task 1: Build the verified source set

**Objective:** Collect primary sources for all seven posts before drafting.

**Files:**
- Reference: `docs/superpowers/specs/2026-09-25-agent-mcp-kubernetes-posts-design.md`
- No tracked output

**Steps:**
1. Fetch official OpenAI documentation or announcement for the Agents API and its sandbox/session behavior.
2. Fetch the original multi-model routing announcement or research material describing single, cascade, and critique routing.
3. Fetch the MCP specification's authorization/security guidance plus original security reports for delayed tool poisoning and runtime governance.
4. Fetch Kubernetes v1.37 official release, rootless kubelet, volume hardening, and original September 2026 security advisories.
5. Register retrieved URLs in the grounded-citations ledger before drafting.
6. Reject search snippets or secondary summaries when an original source is available.

**Verification:** Every planned factual section has at least one fetched primary source; benchmark and vendor claims are labeled as such.

### Task 2: Write the OpenAI Agents API post

**Objective:** Explain the operational trade-off of adopting a managed agent harness.

**Files:**
- Create: `_posts/2026-09-25-openai-agents-api-managed-harness.md`

**Steps:**
1. Add repository-conformant front matter and deterministic Picsum image.
2. Describe the harness boundary, session lifecycle, tool execution, sandbox choices, tracing, failure recovery, and lock-in.
3. Add an adoption checklist and explicit beta-risk caveats.
4. Cite every external product claim and generate the Sources block from the ledger.
5. Verify no unsupported API names, pricing, or benchmark claims remain.

**Verification:** Front matter parses, source IDs resolve, and the post has problem, architecture, failure-mode, checklist, conclusion, and Sources sections.

### Task 3: Write the multi-model routing post

**Objective:** Compare single, cascade, and critique routing without presenting vendor benchmarks as independent evidence.

**Files:**
- Create: `_posts/2026-09-25-multi-model-routing-cascade-critique.md`

**Steps:**
1. Add front matter and deterministic image.
2. Define each routing pattern and its control flow.
3. Analyze evaluator error, escalation loops, correlated model failures, latency, cost, and observability.
4. Provide a workload-specific evaluation matrix and rollout checklist.
5. Cite source-backed claims and generate the Sources block.

**Verification:** The post distinguishes reported results from reproducible measurement and states evaluation conditions.

### Task 4: Write the delayed MCP tool-poisoning post

**Objective:** Turn the reported delayed-activation supply-chain campaign into a defensible testing and containment guide.

**Files:**
- Create: `_posts/2026-09-25-mcp-supply-chain-delayed-tool-poisoning.md`

**Steps:**
1. Add front matter and deterministic image.
2. Explain the observed attack chain without overstating attribution.
3. Model stateful activation, metadata poisoning, credential discovery, covert behavior, and egress.
4. Provide repeated-call testing, clean-room execution, network controls, provenance, revocation, and incident-response checks.
5. Cite original reporting and relevant MCP security guidance.

**Verification:** Observed facts, researcher interpretation, and defensive recommendations are clearly separated.

### Task 5: Write the MCP runtime-governance post

**Objective:** Define an enforceable identity, authorization, and audit model for MCP tool calls.

**Files:**
- Create: `_posts/2026-09-25-mcp-runtime-governance-identity-authorization-audit.md`

**Steps:**
1. Add front matter and deterministic image.
2. Separate human, agent runtime, MCP server, and downstream-service identities.
3. Explain authorization at call time, scoped credentials, approval gates, response filtering, and immutable audit events.
4. Cover deny, revoke, quarantine, and recovery paths.
5. Cite protocol and security sources; generate the Sources block.

**Verification:** The design does not imply that MCP alone supplies enterprise authorization or complete governance.

### Task 6: Write the Kubernetes v1.37 rootless kubelet post

**Objective:** Explain what beta status changes and what operators must still validate.

**Files:**
- Create: `_posts/2026-09-25-kubernetes-137-rootless-kubelet-beta.md`

**Steps:**
1. Add front matter and deterministic image.
2. Describe `KubeletInUserNamespace`, beta defaults, node reporting, and unchanged rootful clusters.
3. Cover kernel, runtime, CNI, privileged-workload, nested-cluster, and version-skew constraints.
4. Provide staged rollout and rollback checks.
5. Cite the Kubernetes release and feature documentation.

**Verification:** Feature-gate default and actual activation are not conflated.

### Task 7: Write the Kubernetes v1.37 volume-hardening post

**Objective:** Explain the new volume security controls, their limits, and safe experimentation.

**Files:**
- Create: `_posts/2026-09-25-kubernetes-137-volume-hardening.md`

**Steps:**
1. Add front matter and deterministic image.
2. Explain `VolumeBindMountOptions`, `EmptyDirVolumeMode`, `noexec`, `nosuid`, `nodev`, and sticky-bit modes.
3. Distinguish container bind-mount options from PersistentVolume filesystem mount options.
4. Cover alpha gates, runtime capability, Linux-only behavior, version skew, and non-silent scheduling/rejection behavior.
5. Include a minimal illustrative manifest only if it matches the official API exactly.
6. Cite official sources and generate the Sources block.

**Verification:** No speculative YAML field or unsupported runtime behavior is included.

### Task 8: Write the September Kubernetes CVE response post

**Objective:** Give operators an exposure-based response plan for the selected September 2026 Kubernetes advisories.

**Files:**
- Create: `_posts/2026-09-25-kubernetes-september-2026-cve-response.md`

**Steps:**
1. Add front matter and deterministic image.
2. Select advisories with primary records available at drafting time.
3. Record affected/fixed versions exactly, with platform and prerequisite constraints.
4. Build an exposure decision tree and patch/mitigation priority.
5. Add post-upgrade verification and residual-risk checks.
6. Cite original advisories and generate the Sources block.

**Verification:** Version ranges and severity scores match primary advisories; absence of known exploitation is not stated unless sourced.

### Task 9: Run content and citation checks

**Objective:** Catch structural, sourcing, duplication, and formatting defects before build.

**Files:**
- Check: `_posts/2026-09-25-*.md`

**Steps:**
1. Confirm exactly seven new post files.
2. Validate required front matter fields and unique titles/slugs.
3. Check for placeholders, malformed links, duplicated paragraphs, and unsupported claims.
4. Verify citation ledgers and generated Sources blocks.
5. Run `git diff --check`.

**Expected:** Seven files pass all checks with no whitespace errors or unresolved citation IDs.

### Task 10: Build and inspect generated HTML

**Objective:** Prove Jekyll accepts the drafts and emits the expected pages.

**Files:**
- Generated, ignored: `_site/blog/<slug>/index.html`

**Steps:**
1. Run `bundle install` only if the locked dependencies are unavailable.
2. Run `bundle exec jekyll build`.
3. Confirm seven expected HTML files exist.
4. Parse each HTML file and verify title, headings, article body, image, and Sources section.
5. Confirm `git status --short` contains only the intended tracked files.

**Expected:** Build exits 0; all seven pages are present and structurally complete.

### Task 11: Review, commit, push, and verify remote state

**Objective:** Publish only the feature branch and verify the exact remote commit.

**Files:**
- Add: seven `_posts/*.md` files
- Add: `docs/plans/2026-09-25-agent-mcp-kubernetes-posts.md`
- Existing committed design: `docs/superpowers/specs/2026-09-25-agent-mcp-kubernetes-posts-design.md`

**Steps:**
1. Review `git diff --stat`, `git diff --check`, and the complete changed-path list.
2. Confirm author identity is `joon0905 <333593277+joon0905@users.noreply.github.com>`.
3. Commit content with `docs: add September agent and Kubernetes posts`.
4. Push `content/2026-09-agent-mcp-kubernetes` to `origin` exactly once.
5. Verify the remote branch SHA through `git ls-remote` and GitHub API.
6. Confirm `master` was not modified and report that no PR or merge was created.

**Expected:** Local HEAD and remote branch SHA match; anonymous repository access remains HTTP 200.
