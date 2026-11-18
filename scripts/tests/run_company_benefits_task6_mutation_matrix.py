#!/usr/bin/env python3
"""Run the frozen Task 6 trust-boundary mutation matrix."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


TEST_NAMES = (
    # Candidate and receipt bytes are authoritative.
    "scripts.tests.test_company_benefits_candidate_pipeline.CandidatePipelineTests.test_external_review_recomputes_actual_candidate_and_receipt_bytes",
    "scripts.tests.test_company_benefits_candidate_pipeline.CandidatePipelineTests.test_integration_binds_verified_benefit_review_to_retained_receipt_bytes",
    "scripts.tests.test_verify_benefit_release_checkpoint.ReleaseCheckpointVerifierTests.test_protocol_2_rejects_rebound_retained_artifact_when_canonical_approval_is_fixed",
    "scripts.tests.test_verify_benefit_release_checkpoint.ReleaseCheckpointVerifierTests.test_current_package_descriptor_binds_both_approval_hashes_to_review_audit",
    # Review metadata uses one strict authority at candidate, compiler, and promoter ingress.
    "scripts.tests.test_company_benefits_independent_review_compiler.IndependentReviewCompilerTests.test_frozen_review_metadata_boundary_matrix",
    "scripts.tests.test_company_benefits_candidate_pipeline.CandidatePipelineTests.test_candidate_review_metadata_urls_are_credential_free_https",
    "scripts.tests.test_company_benefits_candidate_pipeline.CandidatePipelineTests.test_real_promoter_rejects_approved_null_network_failure_tuple",
    "scripts.tests.test_company_benefits_independent_review_compiler.IndependentReviewCompilerTests.test_rework_and_rejection_accept_authoritative_failed_metadata_source_check",
    # Review must precede approval everywhere.
    "scripts.tests.test_company_benefits_candidate_pipeline.CandidatePipelineTests.test_current_promotion_rejects_receipt_review_after_approval_without_writes",
    "scripts.tests.test_company_benefits_candidate_pipeline.CandidatePipelineTests.test_integration_rejects_verified_benefit_review_after_package_approval_without_writes",
    "scripts.tests.test_verify_benefit_release_checkpoint.ReleaseCheckpointVerifierTests.test_current_package_descriptor_requires_review_before_approval",
    # Complete review and outcome contracts are independently reconstructed.
    "scripts.tests.test_company_benefits_candidate_pipeline.CandidatePipelineTests.test_current_integration_revalidates_complete_independent_review_contract",
    "scripts.tests.test_company_benefits_candidate_pipeline.CandidatePipelineTests.test_integration_recomputes_outcomes_from_cells_and_verified_propositions",
    "scripts.tests.test_integrate_company_benefits_series_batch.SeriesIntegrationTests.test_rejects_forged_review_audit_not_bound_to_exact_candidate_payload",
    # Approval rows and replay semantics are global and content-aware.
    "scripts.tests.test_integrate_company_benefits_series_batch.SeriesIntegrationTests.test_approval_row_binds_exact_package_candidate_and_receipt_hashes",
    "scripts.tests.test_integrate_company_benefits_series_batch.SeriesIntegrationTests.test_distinct_empty_reviewed_candidates_may_share_content_digest",
    "scripts.tests.test_verify_benefit_release_checkpoint.ReleaseCheckpointVerifierTests.test_rejects_missing_duplicate_malformed_or_mismatched_approval_rows",
    "scripts.tests.test_verify_benefit_release_checkpoint.ReleaseCheckpointVerifierTests.test_rejects_package_or_receipt_replay_in_unselected_canonical_approval_rows",
    "scripts.tests.test_verify_benefit_release_checkpoint.ReleaseCheckpointVerifierTests.test_allows_repeated_candidate_digest_in_unselected_canonical_approval_row",
    # The release checkpoint validates complete retained packages.
    "scripts.tests.test_verify_benefit_release_checkpoint.ReleaseCheckpointVerifierTests.test_protocol_2_gold_union_rejects_manifest_only_package_directories",
    "scripts.tests.test_verify_benefit_release_checkpoint.ReleaseCheckpointVerifierTests.test_protocol_2_gold_union_accepts_complete_retained_promoted_packages",
    # Ingress and publication stay bounded and transactional.
    "scripts.tests.test_company_benefits_candidate_pipeline.CandidatePipelineTests.test_candidate_rejects_aggregate_bytes_below_individual_file_caps",
    "scripts.tests.test_company_benefits_candidate_pipeline.CandidatePipelineTests.test_review_rejects_aggregate_bytes_below_individual_file_caps",
    "scripts.tests.test_company_benefits_candidate_pipeline.CandidatePipelineTests.test_post_commit_cleanup_of_nonwritable_displaced_tree_never_fails_publication",
    "scripts.tests.test_company_benefits_candidate_pipeline.CandidatePipelineTests.test_displaced_tree_garbage_name_collision_never_replaces_preexisting_directory",
    "scripts.tests.test_company_benefits_candidate_pipeline.CandidatePipelineTests.test_cooperating_publishers_serialize_staging_and_publication_across_processes",
    "scripts.tests.test_company_benefits_candidate_pipeline.CandidatePipelineTests.test_publication_parent_must_be_owned_and_not_group_or_world_writable",
)


def main() -> int:
    suite = unittest.defaultTestLoader.loadTestsFromNames(TEST_NAMES)
    if suite.countTestCases() != len(TEST_NAMES):
        print(
            f"matrix definition error: expected {len(TEST_NAMES)} tests, "
            f"loaded {suite.countTestCases()}",
            file=sys.stderr,
        )
        return 2
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    raise SystemExit(main())
