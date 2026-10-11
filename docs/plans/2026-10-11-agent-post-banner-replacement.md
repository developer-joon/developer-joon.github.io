# AI Agent Post Banner Replacement Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Replace the ten low-quality 2026-10-11 post banners with distinct, topic-specific editorial infographic PNGs and publish them safely.

**Architecture:** A deterministic Pillow generator in the profile scratch directory renders all banners from a declarative manifest. A stdlib verifier first fails against the current assets, then verifies dimensions, PNG mode, metadata, uniqueness, safe-area title placement, and expected file coverage. Only the ten existing PNG paths and the approved design/plan documents enter the repository.

**Tech Stack:** Python 3, Pillow in an isolated scratch virtual environment, Noto Sans KR under the SIL Open Font License, Jekyll Docker build, Git/GitHub CLI.

---

### Task 1: Create the failing banner acceptance verifier

**Objective:** Prove that the current banners fail the approved design contract before generating replacements.

**Files:**
- Create: `/home/bread/.hermes/profiles/conan/cache/scratch/agent-banner-redesign/verify_banners.py`
- Read: `images/posts/2026-10-11-*.png`

**Steps:**
1. Implement a stdlib PNG verifier for the exact ten expected paths.
2. Require 1600×900 RGB PNG, unique bytes, and PNG text metadata keys `Title`, `Series`, `DesignVersion=editorial-infographic-v1`.
3. Run it against the existing images.
4. Expected: FAIL because the current images lack the required metadata and editorial design version.

### Task 2: Build the isolated rendering toolchain

**Objective:** Prepare a copyright-safe, reproducible renderer without modifying project dependencies.

**Files:**
- Create: `/home/bread/.hermes/profiles/conan/cache/scratch/agent-banner-redesign/venv/`
- Create: `/home/bread/.hermes/profiles/conan/cache/scratch/agent-banner-redesign/fonts/`
- Create: `/home/bread/.hermes/profiles/conan/cache/scratch/agent-banner-redesign/generate_banners.py`

**Steps:**
1. Create an isolated virtual environment.
2. Install a pinned Pillow version in the scratch environment.
3. Download Noto Sans KR from the official Google Fonts repository and preserve its OFL license in scratch.
4. Implement shared layout primitives and ten topic-specific infographic renderers.
5. Add generator assertions for image size, title bounds, safe area, expected files, and metadata.

### Task 3: Generate and visually review all ten banners

**Objective:** Produce a coherent series where every banner communicates a distinct article topic.

**Files:**
- Modify: `images/posts/2026-10-11-*.png` (exactly ten files)
- Create: `/home/bread/.hermes/profiles/conan/cache/scratch/agent-banner-redesign/contact-sheet.png`

**Steps:**
1. Generate all ten banners.
2. Run the acceptance verifier; expected: PASS for all ten.
3. Generate a 5×2 contact sheet.
4. Inspect the contact sheet and every individual banner for hierarchy, clipping, contrast, consistency, and topic distinction.
5. Revise the generator and regenerate until the visual review has no weak/fail finding.

### Task 4: Verify content integration and static artifact

**Objective:** Prove that the replacement assets remain correctly wired into all posts and the final site artifact.

**Files:**
- Verify: `_posts/2026-10-11-*.md`
- Verify: `images/posts/2026-10-11-*.png`
- Build: `/home/bread/.hermes/profiles/conan/cache/scratch/agent-banner-site-artifact`

**Steps:**
1. Verify each post’s `featured_image` equals its first body image and points to one of the ten replaced files.
2. Run `git diff --check` and ensure only the approved design/plan docs and ten PNGs changed.
3. Run the repository Docker build with `SITE_BUILD_TIME=2026-10-12T00:00:00+09:00`.
4. Run `node scripts/verify-site.mjs` against the exported artifact.
5. Confirm every rendered post references the expected banner path and the artifact image hash matches the source image hash.

### Task 5: Commit, publish, and verify production

**Objective:** Deliver the visual fix through GitHub and verify the exact new assets on the public site.

**Files:**
- Commit: ten PNGs plus design and implementation plan documents

**Steps:**
1. Run final staged diff and secret checks.
2. Commit the ten image replacements and plan.
3. Confirm GitHub account, push permission, public repository access, and no duplicate PR.
4. Push `fix/replace-2026-10-11-post-banners` and create one PR.
5. Read back the PR file list and head SHA.
6. Merge only after the required verification/check state is acceptable, because the user explicitly requested re-upload/publishing.
7. Wait for the exact merge revision’s Pages deployment.
8. Fetch all ten public image URLs with cache bypass and require HTTP 200 plus SHA-256 equality with the committed images.
9. Verify representative public post pages reference the new banners.
10. Remove temporary servers and report commit, PR, merge, deployment, and public verification separately.
