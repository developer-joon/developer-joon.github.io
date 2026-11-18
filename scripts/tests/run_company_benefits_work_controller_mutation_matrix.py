#!/usr/bin/env python3
"""Run the frozen external work-controller mutation matrix."""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

TEST_NAMES = tuple(
    "scripts.tests.test_company_benefits_work_controller."
    "WorkControllerTests.test_mutation_matrix_" + suffix
    for suffix in (
        "a_absence_requires_independent_terminal_chains",
        "b_authoritative_nonempty_25_250_preflight",
        "c_disposition_authority_is_exact",
        "d_artifact_bindings_are_distinct_and_cell_local",
        "e_descriptor_relative_reads_fail_closed",
        "f_supersession_revalidates_predecessor",
        "g_supersession_rebinds_predecessor_to_canonical_ledgers",
        "h_assignment_load_is_descriptor_relative",
        "i_review_decision_matches_production_cell_state",
        "j_review_strictly_follows_bound_attempts",
        "k_artifact_io_is_preflighted_and_cumulatively_bounded",
        "l_malformed_company_ids_raise_value_error",
    )
)


def main():
    suite = unittest.defaultTestLoader.loadTestsFromNames(TEST_NAMES)
    if suite.countTestCases() != len(TEST_NAMES):
        print(f"matrix definition error: expected {len(TEST_NAMES)} tests, loaded {suite.countTestCases()}",
              file=sys.stderr)
        return 2
    return 0 if unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful() else 1


if __name__ == "__main__":
    raise SystemExit(main())