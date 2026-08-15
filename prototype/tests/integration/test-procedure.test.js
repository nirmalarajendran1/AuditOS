'use strict';

/**
 * Integration Tests — AI Test Procedure Drafting
 *
 * The third agent's contract, asserted against the real Shared Audit State,
 * Repository, and Suggestion Lifecycle Service — including the `testing`
 * repository entry added for it, without which `applyTarget` would resolve to
 * an undefined repository and write nothing while marking the suggestion
 * Applied.
 *
 * The distinction under test is between describing a test and performing one.
 * A drafted procedure is a proposal about what to do; it must never reach the
 * workpaper without a decision, and it must never overwrite a procedure an
 * auditor already recorded.
 *
 * The AI client is stubbed. No network is reachable from the offline sandbox,
 * which is itself asserted — with no backend the workpaper is untouched.
 */

const { loadClassicScripts, SCRIPTS } = require('../lib/prototype');

const ENGAGEMENT_ID = 'ENG-MER-NXSC-2026';

const DRAFT = 'Inspect the production workspace configuration for each user entity to determine whether the Engineering team restricted access by whitelisting their IP addresses.';

const RESULT = {
  text: DRAFT,
  provider: 'Google',
  model: 'gemini-3.1-flash-lite',
  inputTokens: 190,
  outputTokens: 58,
  latencyMs: 900
};

async function boot() {
  const AuditOS = loadClassicScripts([
    SCRIPTS.idService, SCRIPTS.permissions, SCRIPTS.auditService,
    SCRIPTS.demoDataBundle, SCRIPTS.demoDataRegistry, SCRIPTS.stateStore,
    SCRIPTS.repository, SCRIPTS.suggestionService,
    SCRIPTS.aiClient, SCRIPTS.testingAgent
  ]).AuditOS;
  await AuditOS.state.init();
  AuditOS.testingAgent.resetRequestGuard();
  return AuditOS;
}

function stubClient(AuditOS, result, available) {
  const calls = [];
  AuditOS.aiClient = {
    isAvailable: function () {
      return Promise.resolve(available === undefined ? true : available);
    },
    requestProcedure: function (request) {
      calls.push(request);
      return Promise.resolve(result);
    }
  };
  return calls;
}

/** The first real workpaper in this engagement that records no procedure. */
function gap(AuditOS) {
  const testDatasets = AuditOS.repository.testing.datasetsForEngagement(ENGAGEMENT_ID);
  const controlDatasets = AuditOS.repository.controls.datasetsForEngagement(ENGAGEMENT_ID);
  const controls = {};
  AuditOS.repository.controls.list({ datasetId: controlDatasets[0] })
    .forEach(function (control) { controls[control.id] = control; });

  const test = AuditOS.repository.testing.list({ datasetId: testDatasets[0] })
    .filter(function (record) {
      return !String(record.testProcedure || '').trim() && controls[record.controlId];
    })[0];
  return { test: test, control: controls[test.controlId], datasetId: testDatasets[0] };
}

function reloadTest(AuditOS, datasetId, id) {
  return AuditOS.repository.testing.get(id, { datasetId: datasetId });
}

module.exports = function registerIntegrationTests(harness) {
  const test = harness.test;
  const assert = harness.assert;

  // ---- The fixture itself is a claim worth asserting.

  test('the engagement really does record workpapers with no procedure', async function () {
    const AuditOS = await boot();
    const target = gap(AuditOS);
    assert.ok(target.test, 'a workpaper with no recorded procedure exists');
    assert.ok(target.control && target.control.descriptionText,
      'and its linked control carries a description to draft from');
  });

  // ---- The default state.

  test('with no AI backend the workpaper is untouched', async function () {
    const AuditOS = await boot();
    const target = gap(AuditOS);
    const before = AuditOS.suggestionService.list(AuditOS.repository, ENGAGEMENT_ID).length;

    const proposed = await AuditOS.testingAgent.requestDraft({
      engagementId: ENGAGEMENT_ID, test: target.test, control: target.control
    });

    assert.equal(proposed, null);
    assert.equal(AuditOS.suggestionService.list(AuditOS.repository, ENGAGEMENT_ID).length, before);
    assert.equal(String(reloadTest(AuditOS, target.datasetId, target.test.id).testProcedure || ''), '');
  });

  // ---- Drafting proposes; it does not write.

  test('a draft is filed as a Suggestion, never written to the workpaper', async function () {
    const AuditOS = await boot();
    stubClient(AuditOS, RESULT);
    const target = gap(AuditOS);

    const suggestion = await AuditOS.testingAgent.requestDraft({
      engagementId: ENGAGEMENT_ID, test: target.test, control: target.control
    });

    assert.ok(suggestion);
    assert.equal(suggestion.status, AuditOS.suggestionService.STATUS.SUGGESTED);
    assert.equal(suggestion.description, DRAFT);
    assert.equal(String(reloadTest(AuditOS, target.datasetId, target.test.id).testProcedure || ''), '',
      'the workpaper still records no procedure');
  });

  test('the draft is attributed to the provider and carries its apply target', async function () {
    const AuditOS = await boot();
    stubClient(AuditOS, RESULT);
    const target = gap(AuditOS);

    const suggestion = await AuditOS.testingAgent.requestDraft({
      engagementId: ENGAGEMENT_ID, test: target.test, control: target.control
    });

    assert.equal(suggestion.suggestedBy, 'Google');
    assert.equal(suggestion.category, 'test-procedure');
    assert.equal(suggestion.confidence, null);
    assert.equal(suggestion.applyTarget.entity, 'testing');
    assert.equal(suggestion.applyTarget.recordId, target.test.id);
    assert.equal(suggestion.applyTarget.changes.testProcedure, DRAFT);
    assert.equal(suggestion.applyTarget.changes.aiLineage.kind, 'ai-generated');
  });

  test('the suggestion is findable by the Testing inspector', async function () {
    const AuditOS = await boot();
    stubClient(AuditOS, RESULT);
    const target = gap(AuditOS);

    const suggestion = await AuditOS.testingAgent.requestDraft({
      engagementId: ENGAGEMENT_ID, test: target.test, control: target.control
    });

    // deriveWorkpaperSuggestions matches on auditReferences / affectedControls
    // against the row's id, controlCode, or workpaperId.
    const references = Array.from(suggestion.auditReferences)
      .concat(Array.from(suggestion.affectedControls));
    assert.ok(references.indexOf(target.test.id) !== -1, 'the workpaper id is referenced');
    assert.ok(references.indexOf(target.control.controlCode) !== -1, 'and the control code');
  });

  // ---- Approval is what publishes.

  test('approving and applying writes the procedure to the workpaper', async function () {
    const AuditOS = await boot();
    const service = AuditOS.suggestionService;
    stubClient(AuditOS, RESULT);
    const target = gap(AuditOS);

    let suggestion = await AuditOS.testingAgent.requestDraft({
      engagementId: ENGAGEMENT_ID, test: target.test, control: target.control
    });
    suggestion = service.review(AuditOS.repository, ENGAGEMENT_ID, suggestion, '');
    suggestion = service.decide(AuditOS.repository, ENGAGEMENT_ID, suggestion, 'approve', '');
    assert.equal(String(reloadTest(AuditOS, target.datasetId, target.test.id).testProcedure || ''), '',
      'approval alone does not publish');

    service.decide(AuditOS.repository, ENGAGEMENT_ID, suggestion, 'apply', '');

    const record = reloadTest(AuditOS, target.datasetId, target.test.id);
    assert.equal(record.testProcedure, DRAFT, 'the procedure is now on the workpaper');
    assert.equal(record.aiLineage.generatedBy, 'Google', 'with its provenance');
  });

  // ---- Declining rather than guessing.

  test('a workpaper that already records a procedure is never redrafted', async function () {
    const AuditOS = await boot();
    const calls = stubClient(AuditOS, RESULT);
    const target = gap(AuditOS);
    const recorded = Object.assign({}, target.test, { testProcedure: 'Inspected the recorded configuration.' });

    const proposed = await AuditOS.testingAgent.requestDraft({
      engagementId: ENGAGEMENT_ID, test: recorded, control: target.control
    });

    assert.equal(proposed, null, "an agent does not overwrite the auditor's own procedure");
    assert.equal(calls.length, 0);
  });

  test('a control with no description is never drafted from', async function () {
    const AuditOS = await boot();
    const calls = stubClient(AuditOS, RESULT);
    const target = gap(AuditOS);

    const proposed = await AuditOS.testingAgent.requestDraft({
      engagementId: ENGAGEMENT_ID, test: target.test,
      control: Object.assign({}, target.control, { descriptionText: '' })
    });

    assert.equal(proposed, null);
    assert.equal(calls.length, 0, 'nothing to draft from means the model is never asked');
  });

  test('a missing linked control declines rather than guessing', async function () {
    const AuditOS = await boot();
    const calls = stubClient(AuditOS, RESULT);
    const target = gap(AuditOS);

    const proposed = await AuditOS.testingAgent.requestDraft({
      engagementId: ENGAGEMENT_ID, test: target.test, control: null
    });

    assert.equal(proposed, null);
    assert.equal(calls.length, 0);
  });

  test('a pending draft blocks a second one for the same workpaper', async function () {
    const AuditOS = await boot();
    stubClient(AuditOS, RESULT);
    const target = gap(AuditOS);

    const first = await AuditOS.testingAgent.requestDraft({
      engagementId: ENGAGEMENT_ID, test: target.test, control: target.control
    });
    AuditOS.testingAgent.resetRequestGuard();
    const second = await AuditOS.testingAgent.requestDraft({
      engagementId: ENGAGEMENT_ID, test: target.test, control: target.control
    });

    assert.ok(first);
    assert.equal(second, null);
  });

  test('an unreachable backend is checked once, never POSTed to', async function () {
    const AuditOS = await boot();
    const calls = stubClient(AuditOS, RESULT, false);
    const target = gap(AuditOS);

    const proposed = await AuditOS.testingAgent.requestDraft({
      engagementId: ENGAGEMENT_ID, test: target.test, control: target.control
    });

    assert.equal(proposed, null);
    assert.equal(calls.length, 0);
  });

  test('a provider failure files nothing and never rejects', async function () {
    const AuditOS = await boot();
    stubClient(AuditOS, null);
    const target = gap(AuditOS);
    const before = AuditOS.suggestionService.list(AuditOS.repository, ENGAGEMENT_ID).length;

    const proposed = await AuditOS.testingAgent.requestDraft({
      engagementId: ENGAGEMENT_ID, test: target.test, control: target.control
    });

    assert.equal(proposed, null);
    assert.equal(AuditOS.suggestionService.list(AuditOS.repository, ENGAGEMENT_ID).length, before);
  });

  test('the control description is what the model is asked about', async function () {
    const AuditOS = await boot();
    const calls = stubClient(AuditOS, RESULT);
    const target = gap(AuditOS);

    await AuditOS.testingAgent.requestDraft({
      engagementId: ENGAGEMENT_ID, test: target.test, control: target.control
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].controlDescription, target.control.descriptionText);
    assert.equal(calls[0].controlCode, target.control.controlCode);
    assert.deepEqual(Array.from(calls[0].criteriaIds), Array.from(target.control.criteriaIds || []),
      'the criteria list the backend validates citations against');
  });
};
