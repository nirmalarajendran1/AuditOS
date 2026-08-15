"""
Unit tests — AuditOS narrative backend.

Covers the two guarantees the browser cannot make for itself: that whatever the
model returns is reduced to the one plain-text paragraph the renderer requires,
and that a draft stating a figure the recorded facts do not is refused rather
than returned.

Node standard library on the browser side, Python standard library here: run
with `python3 -m unittest discover -s backend`, no pytest and no other
dependency. Only the pure helpers are exercised — no network, no API key, and
no FastAPI import — so these run in any environment that has Python.
"""

import os
import re
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def _load_helpers():
    """Loads the pure helpers out of main.py without importing FastAPI.

    main.py imports fastapi/pydantic at module scope, which these tests must not
    require. The helpers below depend on nothing but `re`, so they are compiled
    in isolation — the same source, none of the service around it.
    """
    source = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "main.py")).read()
    start = source.index("def enforce_single_paragraph")
    end = source.index("@app.get")
    namespace = {"re": re, "List": list}
    exec(compile(source[start:end], "main.py-helpers", "exec"), namespace)
    return namespace


HELPERS = _load_helpers()
enforce_single_paragraph = HELPERS["enforce_single_paragraph"]
ungrounded_numbers = HELPERS["ungrounded_numbers"]
numbers_in = HELPERS["numbers_in"]

FACTS = (
    "Recorded facts for this engagement:\n"
    "- Walkthrough understanding: 12 recorded walkthrough sessions inform this description.\n"
    "- Evidence basis: 75 of 283 evidence items are approved and available to this description.\n"
    "- Controls in scope: 94 controls are in scope for the engagement.\n"
    "- Testing performed: 88 of 94 test workpapers are complete.\n"
    "- Approved findings: 3 approved observations feed this description."
)


class EnforceSingleParagraphTests(unittest.TestCase):
    """The renderer assigns the narrative through textContent into one <p>, so
    newlines would render as a run-on and Markdown as literal punctuation."""

    def test_collapses_whitespace(self):
        self.assertEqual(enforce_single_paragraph("  hello   world  "), "hello world")

    def test_collapses_newlines_into_one_paragraph(self):
        self.assertEqual(enforce_single_paragraph("one\n\ntwo\nthree"), "one two three")

    def test_strips_bold_and_italic_markers(self):
        self.assertEqual(enforce_single_paragraph("**bold** and _ital_"), "bold and ital")

    def test_strips_headings_and_bullets(self):
        self.assertEqual(enforce_single_paragraph("# Title\n- a\n- b"), "Title a b")

    def test_strips_code_fences(self):
        self.assertEqual(enforce_single_paragraph("```\ntext\n```"), "text")

    def test_leaves_clean_prose_untouched(self):
        prose = "The description is informed by 12 recorded walkthrough sessions."
        self.assertEqual(enforce_single_paragraph(prose), prose)

    def test_output_never_contains_a_newline(self):
        for raw in ["a\nb", "a\r\nb", "# h\n\n- x\n- y", "```\np\n```"]:
            self.assertNotIn("\n", enforce_single_paragraph(raw))


class NumbersInTests(unittest.TestCase):
    def test_extracts_integers_decimals_and_thousands(self):
        self.assertEqual(
            numbers_in("94 controls, 26.5% complete, 1,240 items"),
            {"94", "26.5", "1240"},
        )

    def test_no_numbers_yields_empty_set(self):
        self.assertEqual(numbers_in("no figures at all"), set())


class GroundingTests(unittest.TestCase):
    """A fabricated figure in a System Description would read as an audited
    fact. Every number in a draft must appear in the recorded facts."""

    def test_grounded_draft_passes(self):
        draft = (
            "The description is informed by 12 recorded walkthrough sessions, with "
            "75 of 283 evidence items approved. 94 controls are in scope and 88 of "
            "94 test workpapers are complete, with 3 approved observations."
        )
        self.assertEqual(ungrounded_numbers(draft, FACTS), [])

    def test_invented_figure_is_caught(self):
        draft = "127 controls are in scope for the engagement."
        self.assertEqual(ungrounded_numbers(draft, FACTS), ["127"])

    def test_computed_total_is_caught(self):
        # 283 - 75 = 208 is arithmetic the model was told not to perform.
        draft = "208 evidence items remain outstanding."
        self.assertEqual(ungrounded_numbers(draft, FACTS), ["208"])

    def test_invented_year_is_caught(self):
        draft = "The system was assessed over the year ended 2025."
        self.assertEqual(ungrounded_numbers(draft, FACTS), ["2025"])

    def test_prose_without_figures_passes(self):
        draft = "The description is generated from recorded walkthrough understanding."
        self.assertEqual(ungrounded_numbers(draft, FACTS), [])

    def test_thousands_separator_does_not_read_as_ungrounded(self):
        self.assertEqual(ungrounded_numbers("1,240 items", "facts: 1240 items"), [])

    def test_multiple_inventions_are_all_reported(self):
        draft = "500 controls, 42 findings."
        self.assertEqual(ungrounded_numbers(draft, FACTS), ["42", "500"])


if __name__ == "__main__":
    unittest.main()
