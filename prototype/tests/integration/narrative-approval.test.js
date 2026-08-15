'use strict';

/**
 * Integration Tests — AI Narrative Approval Path
 *
 * The governance contract of the platform's first AI agent, asserted end to end
 * against the real Shared Audit State, Repository, Suggestion Lifecycle Service,
 * and Report Generation Service.
 *
 * The claim under test is the one `report-generation-service.js` makes for this
 * seam: an AI draft "still enters the report only through the Suggestion →
 * Approval → Propagation path, so human approval remains mandatory and nothing
 * here writes directly." So these suites verify not only that an approved draft
 * reaches the report, but that an *un*approved one reaches nothing — not the
 * section record, not `draftNarrative`, not the exports.
 *
 * The AI client is stubbed. No network is reachable from the offline sandbox
 * (`fetch` is absent), which is itself asserted: with no backend running, the
 * agent proposes nothing and the report is unchanged.
 */

const { loadAiFoundation, SCRIPTS, loadClassicScripts } = require('../lib/prototype');

const ENGAGEMENT_ID = 'ENG-MER-QA-2026';
const SECTION_ID = 'SEC-3';

const DRAFT = 'The description is informed by 12 recorded walkthrough sessions.';

const RESULT = {
  text: DRAFT,
  provider: 'Google',
  model: 'gemini-3.1-flash-lite',
  inputTokens: 180,
  outputTokens: 64,
  latencyMs: 700
};

/** The section shape the Reporting workspace hands the agent. */
function section(overrides) {
  const base = {
    id: SECTION_ID,
    key: 'system-description',
    title: 'System Description',
    narrative: null,
    blocks: [
      { label: 'Walkthrough understanding', present: true, text: '12 recorded walkthrough sessions inform this description.' },
      { label: 'Controls in scope', present: true, text: '94 controls are in scope for the engagement.' }
    ]
  };
  Object.keys(overrides || {}).forEach(function (key) { base[key] = overrides[key]; });
  return base;
}

/** Boots the AI foundation over the state/repository stack, state loaded. */
async function boot() {
  const AuditOS = loadAiFoundation();
  await AuditOS.state.init();
  AuditOS.narrativeAgent.resetRequestGuard();
  return AuditOS;
}

/** Replaces the transport with a stub resolving `result`, recording its calls. */
function stubClient(AuditOS, result, available) {
  const calls = [];
  AuditOS.aiClient = {
    isAvailable: function () {
      return Promise.resolve(available === undefined ? true : available);
    },
    requestNarrative: function (request) {
      calls.push(request);
      return Promise.resolve(result);
    }
  };
  return calls;
}

function sectionRecord(AuditOS) {
  const datasets = AuditOS.repository.reports.datasetsForEngagement(ENGAGEMENT_ID);
  return AuditOS.repository.reports.get(SECTION_ID, { datasetId: datasets[0] });
}

module.exports = function registerIntegrationTests(harness) {
  const test = harness.test;
  const assert = harness.assert;

  // ---- The default state: no backend, nothing proposed, nothing changed.

  test('with no AI backend the agent proposes nothing and the report is unchanged', async function () {
    const AuditOS = await boot();
    const before = AuditOS.suggestionService.list(AuditOS.repository, ENGAGEMENT_ID).length;

    // The real client, in a sandbox with no fetch — exactly the file:// case.
    const proposed = await AuditOS.narrativeAgent.requestDraft({
      engagementId: ENGAGEMENT_ID, section: section()
    });

    assert.equal(proposed, null, 'no suggestion is filed');
    assert.equal(AuditOS.suggestionService.list(AuditOS.repository, ENGAGEMENT_ID).length, before,
      'the suggestion register is untouched');
    assert.equal(sectionRecord(AuditOS).narrative, undefined, 'the report records no narrative');
  });

  // ---- Drafting files a proposal — and only a proposal.

  test('a draft is filed as a Suggestion, never written to the report', async function () {
    const AuditOS = await boot();
    stubClient(AuditOS, RESULT);

    const suggestion = await AuditOS.narrativeAgent.requestDraft({
      engagementId: ENGAGEMENT_ID, section: section()
    });

    assert.ok(suggestion, 'a suggestion is created');
    assert.equal(suggestion.status, AuditOS.suggestionService.STATUS.SUGGESTED,
      'it enters the lifecycle at Suggested, awaiting a human');
    assert.equal(suggestion.description, DRAFT, 'the drafted prose is the proposal body');
    assert.equal(sectionRecord(AuditOS).narrative, undefined,
      'the report itself is not written — this is the whole governance claim');
  });

  test('an unapproved draft reaches draftNarrative as nothing at all', async function () {
    const AuditOS = await boot();
    stubClient(AuditOS, RESULT);
    await AuditOS.narrativeAgent.requestDraft({ engagementId: ENGAGEMENT_ID, section: section() });

    const generation = loadClassicScripts([SCRIPTS.reportGeneration]).AuditOS.reportGenerationService;
    assert.equal(generation.draftNarrative('system-description', [], {}, sectionRecord(AuditOS)), null,
      'a pending draft renders as no narrative, not as prose');
  });

  test('the suggestion is attributed to the provider, not the signed-in reviewer', async function () {
    const AuditOS = await boot();
    stubClient(AuditOS, RESULT);
    const suggestion = await AuditOS.narrativeAgent.requestDraft({
      engagementId: ENGAGEMENT_ID, section: section()
    });

    assert.equal(suggestion.suggestedBy, 'Google',
      'an immutable audit trail must name the real author of the prose');
    assert.equal(suggestion.category, 'report-narrative',
      'AI-drafted prose is distinguishable from a human-proposed report edit');
    assert.equal(suggestion.confidence, null,
      'no calibrated confidence exists, so none is fabricated');
  });

  test('the suggestion carries the concrete write to perform on Apply', async function () {
    const AuditOS = await boot();
    stubClient(AuditOS, RESULT);
    const suggestion = await AuditOS.narrativeAgent.requestDraft({
      engagementId: ENGAGEMENT_ID, section: section()
    });

    const target = suggestion.applyTarget;
    assert.equal(target.entity, 'reports');
    assert.equal(target.recordId, SECTION_ID);
    assert.equal(target.changes.narrative, DRAFT);
    assert.equal(target.changes.aiLineage.kind, 'ai-generated');
    assert.equal(target.changes.aiLineage.generatedBy, 'Google');
    assert.equal(target.changes.aiLineage.model, 'gemini-3.1-flash-lite');
    assert.equal(target.changes.aiLineage.confidence, null);
    assert.deepEqual(Array.from(suggestion.affectedReportSections), [SECTION_ID],
      'the Reporting inspector filters its section-scoped list on this');
  });

  // ---- Approval is what publishes.

  test('approving and applying publishes the narrative to the report', async function () {
    const AuditOS = await boot();
    const service = AuditOS.suggestionService;
    const repository = AuditOS.repository;
    stubClient(AuditOS, RESULT);

    let suggestion = await AuditOS.narrativeAgent.requestDraft({
      engagementId: ENGAGEMENT_ID, section: section()
    });

    suggestion = service.review(repository, ENGAGEMENT_ID, suggestion, '');
    suggestion = service.decide(repository, ENGAGEMENT_ID, suggestion, 'approve', '');
    assert.equal(sectionRecord(AuditOS).narrative, undefined,
      'approval alone does not publish — Apply performs the write');

    service.decide(repository, ENGAGEMENT_ID, suggestion, 'apply', '');

    const record = sectionRecord(AuditOS);
    assert.equal(record.narrative, DRAFT, 'the approved prose is now on the section record');
    assert.equal(record.aiLineage.generatedBy, 'Google',
      'lineage is recorded at publication, so provenance travels with the prose');

    const generation = loadClassicScripts([SCRIPTS.reportGeneration]).AuditOS.reportGenerationService;
    assert.equal(generation.draftNarrative('system-description', [], {}, record), DRAFT,
      'and draftNarrative now returns it');
  });

  test('every step of the path is recorded in the audit trail', async function () {
    const AuditOS = await boot();
    const service = AuditOS.suggestionService;
    const repository = AuditOS.repository;
    stubClient(AuditOS, RESULT);

    let suggestion = await AuditOS.narrativeAgent.requestDraft({
      engagementId: ENGAGEMENT_ID, section: section()
    });
    suggestion = service.review(repository, ENGAGEMENT_ID, suggestion, '');
    suggestion = service.decide(repository, ENGAGEMENT_ID, suggestion, 'approve', '');
    service.decide(repository, ENGAGEMENT_ID, suggestion, 'apply', '');

    const actions = AuditOS.auditService.listForEntity(suggestion.id, 'suggestions')
      .map(function (event) { return event.action; });
    ['suggestion-proposed', 'suggestion-approved', 'suggestion-applied'].forEach(function (action) {
      assert.ok(actions.indexOf(action) !== -1, action + ' is recorded');
    });
  });

  // ---- The agent declines rather than duplicating or inventing.

  test('a section recording no facts is never drafted from', async function () {
    const AuditOS = await boot();
    const calls = stubClient(AuditOS, RESULT);

    const proposed = await AuditOS.narrativeAgent.requestDraft({
      engagementId: ENGAGEMENT_ID,
      section: section({ blocks: [{ label: 'Evidence', present: false, text: 'No evidence is recorded.' }] })
    });

    assert.equal(proposed, null, 'nothing recorded means nothing to draft from');
    assert.equal(calls.length, 0, 'and the model is never asked — invention starts here otherwise');
  });

  test('a section with an approved narrative is not redrafted', async function () {
    const AuditOS = await boot();
    const calls = stubClient(AuditOS, RESULT);

    const proposed = await AuditOS.narrativeAgent.requestDraft({
      engagementId: ENGAGEMENT_ID, section: section({ narrative: DRAFT })
    });

    assert.equal(proposed, null);
    assert.equal(calls.length, 0, 'no spend on prose that already exists');
  });

  test('a pending draft blocks a second one for the same section', async function () {
    const AuditOS = await boot();
    stubClient(AuditOS, RESULT);

    const first = await AuditOS.narrativeAgent.requestDraft({
      engagementId: ENGAGEMENT_ID, section: section()
    });
    AuditOS.narrativeAgent.resetRequestGuard();
    const second = await AuditOS.narrativeAgent.requestDraft({
      engagementId: ENGAGEMENT_ID, section: section()
    });

    assert.ok(first, 'the first draft is filed');
    assert.equal(second, null, 'the reviewer decides on what exists before more is proposed');
  });

  test('an unreachable backend is checked once, never POSTed to', async function () {
    const AuditOS = await boot();
    const calls = stubClient(AuditOS, RESULT, false);

    const proposed = await AuditOS.narrativeAgent.requestDraft({
      engagementId: ENGAGEMENT_ID, section: section()
    });

    assert.equal(proposed, null);
    assert.equal(calls.length, 0,
      'availability gates the draft request, so a stopped backend costs one memoized probe per session rather than a doomed POST per render');
  });

  test('only the system-description section is drafted', async function () {
    const AuditOS = await boot();
    const calls = stubClient(AuditOS, RESULT);

    const proposed = await AuditOS.narrativeAgent.requestDraft({
      engagementId: ENGAGEMENT_ID, section: section({ key: 'testing-results', id: 'SEC-4' })
    });

    assert.equal(proposed, null);
    assert.equal(calls.length, 0);
  });

  test('a provider failure files nothing and never rejects', async function () {
    const AuditOS = await boot();
    stubClient(AuditOS, null);

    const before = AuditOS.suggestionService.list(AuditOS.repository, ENGAGEMENT_ID).length;
    const proposed = await AuditOS.narrativeAgent.requestDraft({
      engagementId: ENGAGEMENT_ID, section: section()
    });

    assert.equal(proposed, null);
    assert.equal(AuditOS.suggestionService.list(AuditOS.repository, ENGAGEMENT_ID).length, before,
      'a failed draft leaves no partial state behind');
  });
};
