'use strict';

/**
 * Unit Tests — Report Narrative (`draftNarrative`)
 *
 * Exercises the narrative contract of the Report Generation Service: what
 * `draftNarrative` returns, and — just as importantly — what the rest of the
 * report model does *not* do when a narrative exists.
 *
 * The function reads an approved narrative off the section record; it never
 * calls a model and never writes. Drafting is asynchronous and every draft is a
 * proposal, so it belongs to the Narrative Agent, which files drafts as
 * Suggestions (see tests/integration/narrative-approval.test.js). That split is
 * what these suites pin down: a section with no approved narrative renders
 * exactly as it did before AI existed, and a section with one is byte-identical
 * apart from the added paragraph.
 *
 * Pure and offline: plain fixture records in, plain report model out — no DOM,
 * no AuditOS.state, no network.
 */

const { loadReportGenerationService } = require('../lib/prototype');

/** The operational shape `buildSystemDescriptionBlocks` reads. */
const OPERATIONAL = {
  walkthroughSessions: 12,
  evidenceItems: 283,
  evidenceApproved: 75,
  controls: 94,
  tests: 94,
  testsCompleted: 88,
  approvedFindings: 3
};

const NARRATIVE = 'The description is informed by 12 recorded walkthrough sessions.';

/** A report document whose Section III record carries `narrative` or not. */
function reportDocument(narrative) {
  const section = {
    id: 'SEC-3',
    name: 'Description of the System',
    source: 'structured',
    editable: true,
    included: true
  };
  if (narrative !== undefined) {
    section.narrative = narrative;
  }
  return { document: { title: 'Fixture report' }, sections: [section] };
}

function systemDescription(report) {
  return report.sections.filter(function (section) {
    return section.key === 'system-description';
  })[0];
}

module.exports = function registerUnitTests(harness) {
  const test = harness.test;
  const assert = harness.assert;
  const service = loadReportGenerationService();

  // ---- draftNarrative: the null contract. Every one of these is a state the
  // application already renders correctly, so none of them may return prose.

  test('draftNarrative returns null when no section record exists', function () {
    assert.equal(service.draftNarrative('system-description', [], {}, null), null);
    assert.equal(service.draftNarrative('system-description', [], {}, undefined), null);
  });

  test('draftNarrative returns null when the record declares no narrative', function () {
    assert.equal(service.draftNarrative('system-description', [], {}, { id: 'SEC-3' }), null);
  });

  test('draftNarrative returns null for a non-string narrative', function () {
    [42, true, {}, [], null].forEach(function (value) {
      assert.equal(service.draftNarrative('system-description', [], {}, { narrative: value }), null,
        'fabricates nothing from a malformed record');
    });
  });

  test('draftNarrative returns null for an empty or whitespace-only narrative', function () {
    assert.equal(service.draftNarrative('system-description', [], {}, { narrative: '' }), null);
    assert.equal(service.draftNarrative('system-description', [], {}, { narrative: '   \n  ' }), null);
  });

  // ---- draftNarrative: the approved path.

  test('draftNarrative returns the approved narrative, trimmed', function () {
    assert.equal(
      service.draftNarrative('system-description', [], {}, { narrative: '  ' + NARRATIVE + '  ' }),
      NARRATIVE,
      'surrounding whitespace never reaches the single <p> the renderer builds'
    );
  });

  test('draftNarrative reads the record only — blocks and context change nothing', function () {
    const blocks = service.buildSystemDescriptionBlocks(OPERATIONAL);
    assert.equal(service.draftNarrative('system-description', blocks, { anything: true }, {}), null,
      'recorded facts alone never produce prose; only an approved narrative does');
  });

  // ---- The report model: unchanged by the presence or absence of a narrative.

  test('Section III narrative is null when nothing is approved', function () {
    const section = systemDescription(service.buildReport(reportDocument(), OPERATIONAL, {}));
    assert.equal(section.narrative, null, 'the pre-AI behaviour, exactly intact');
    assert.ok(section.blocks.length > 0, 'the recorded facts still render');
  });

  test('Section III carries the approved narrative when one exists', function () {
    const section = systemDescription(service.buildReport(reportDocument(NARRATIVE), OPERATIONAL, {}));
    assert.equal(section.narrative, NARRATIVE);
  });

  test('an approved narrative supplements the recorded facts, never replaces them', function () {
    const without = systemDescription(service.buildReport(reportDocument(), OPERATIONAL, {}));
    const with_ = systemDescription(service.buildReport(reportDocument(NARRATIVE), OPERATIONAL, {}));
    assert.deepEqual(
      Array.from(with_.blocks).map(function (block) { return block.text; }),
      Array.from(without.blocks).map(function (block) { return block.text; }),
      'the five fact blocks are identical either way'
    );
  });

  test('section identity and status are untouched by a narrative', function () {
    const without = systemDescription(service.buildReport(reportDocument(), OPERATIONAL, {}));
    const with_ = systemDescription(service.buildReport(reportDocument(NARRATIVE), OPERATIONAL, {}));
    ['id', 'key', 'numeral', 'canonicalTitle', 'generated', 'audited', 'present', 'itemCount',
      'source', 'status', 'editable', 'included', 'generationNotice'].forEach(function (field) {
      assert.deepEqual(with_[field], without[field],
        field + ' is unchanged — the narrative adds prose and nothing else');
    });
  });

  test('a narrative on Section III leaves every other section alone', function () {
    const report = service.buildReport(reportDocument(NARRATIVE), OPERATIONAL, {});
    Array.from(report.sections).forEach(function (section) {
      if (section.key !== 'system-description') {
        assert.equal(section.narrative, null,
          section.key + ' is not a narrative section and never gains prose');
      }
    });
  });

  test('report completion counts are unchanged by a narrative', function () {
    const without = service.buildReport(reportDocument(), OPERATIONAL, {}).completion;
    const with_ = service.buildReport(reportDocument(NARRATIVE), OPERATIONAL, {}).completion;
    assert.deepEqual(
      { g: with_.generated, gt: with_.generatedTotal, s: with_.sections, t: with_.total },
      { g: without.generated, gt: without.generatedTotal, s: without.sections, t: without.total }
    );
  });
};
