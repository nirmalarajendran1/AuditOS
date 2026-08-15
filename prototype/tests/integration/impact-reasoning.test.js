'use strict';

/**
 * Integration Tests — AI Impact Reasoning
 *
 * The second agent's contract, asserted against the real Shared Audit State,
 * Repository, and Suggestion Lifecycle Service.
 *
 * This agent differs from the Narrative Agent in a way worth pinning down: it
 * proposes nothing. Its output is the advisory text on an edit suggestion a
 * human is already deciding on, so what these suites verify is that it sharpens
 * that text and touches nothing else — not the edit under review, not the
 * suggestion's lifecycle state, and not the report.
 *
 * The AI client is stubbed; no network is reachable from the offline sandbox,
 * which is itself asserted — with no backend the suggestion keeps exactly the
 * structural description `describeImpact` gave it.
 */

const { loadClassicScripts, SCRIPTS } = require('../lib/prototype');

const ENGAGEMENT_ID = 'ENG-MER-QA-2026';

const IMPACT = [
  { domain: 'walkthrough', label: 'Walkthrough', workspaceId: 'walkthrough', count: 0, present: false,
    description: 'Section III — Description of the System is generated from Walkthrough.' },
  { domain: 'evidence', label: 'Evidence', workspaceId: 'evidence', count: 301, present: true,
    description: 'Section III — Description of the System is generated from Evidence.' }
];

const RESULT = {
  impacts: [
    { domain: 'walkthrough', reasoning: 'No sessions are recorded, so nothing supports the revised wording yet.' },
    { domain: 'evidence', reasoning: 'Confirm the approved items still evidence the changed statement.' }
  ],
  provider: 'Google',
  model: 'gemini-3.1-flash-lite',
  inputTokens: 210,
  outputTokens: 48,
  latencyMs: 640
};

/** Boots the AI foundation over the state/repository stack, state loaded. */
async function boot() {
  const w = loadClassicScripts([
    SCRIPTS.idService, SCRIPTS.permissions, SCRIPTS.auditService,
    SCRIPTS.demoDataBundle, SCRIPTS.demoDataRegistry, SCRIPTS.stateStore,
    SCRIPTS.repository, SCRIPTS.suggestionService,
    SCRIPTS.aiClient, SCRIPTS.narrativeAgent, SCRIPTS.impactAgent,
    SCRIPTS.reportGeneration, SCRIPTS.reportPropagation
  ]);
  const AuditOS = w.AuditOS;
  await AuditOS.state.init();
  AuditOS.impactAgent.resetRequestGuard();
  return AuditOS;
}

function stubClient(AuditOS, result, available) {
  const calls = [];
  AuditOS.aiClient = {
    isAvailable: function () {
      return Promise.resolve(available === undefined ? true : available);
    },
    requestImpact: function (request) {
      calls.push(request);
      return Promise.resolve(result);
    }
  };
  return calls;
}

/** Files a real edit suggestion the way the Reporting workspace does. */
function proposeEdit(AuditOS) {
  return AuditOS.suggestionService.propose(AuditOS.repository, ENGAGEMENT_ID, {
    title: 'Report edit: Section III',
    description: 'The system is hosted on GCP.',
    category: 'report-edit',
    workspaceId: 'reporting',
    affectedReportSections: ['SEC-3'],
    recommendations: IMPACT.map(function (entry) { return entry.description; })
  });
}

function reload(AuditOS, id) {
  return AuditOS.suggestionService.list(AuditOS.repository, ENGAGEMENT_ID)
    .filter(function (s) { return s.id === id; })[0];
}

module.exports = function registerIntegrationTests(harness) {
  const test = harness.test;
  const assert = harness.assert;

  // ---- The default state: no backend, structural text stands.

  test('with no AI backend the structural description is left intact', async function () {
    const AuditOS = await boot();
    const suggestion = proposeEdit(AuditOS);
    const before = Array.from(suggestion.recommendations);

    // The real client, in a sandbox with no fetch — exactly the file:// case.
    const updated = await AuditOS.impactAgent.requestReasoning({
      engagementId: ENGAGEMENT_ID, suggestion: suggestion, impact: IMPACT,
      sectionLabel: 'Section III', editText: 'The system is hosted on GCP.'
    });

    assert.equal(updated, null, 'nothing is rewritten');
    assert.deepEqual(Array.from(reload(AuditOS, suggestion.id).recommendations), before,
      'the reviewer still gets the structural guidance');
  });

  // ---- The upgrade.

  test('AI reasoning replaces the structural text on the same suggestion', async function () {
    const AuditOS = await boot();
    stubClient(AuditOS, RESULT);
    const suggestion = proposeEdit(AuditOS);

    const updated = await AuditOS.impactAgent.requestReasoning({
      engagementId: ENGAGEMENT_ID, suggestion: suggestion, impact: IMPACT,
      sectionLabel: 'Section III', editText: 'The system is hosted on GCP.'
    });

    assert.ok(updated, 'the suggestion is updated');
    assert.equal(updated.id, suggestion.id, 'the same suggestion — no second proposal is filed');
    assert.deepEqual(Array.from(updated.recommendations), [
      'Walkthrough: No sessions are recorded, so nothing supports the revised wording yet.',
      'Evidence: Confirm the approved items still evidence the changed statement.'
    ]);
  });

  test('the edit under review is untouched', async function () {
    const AuditOS = await boot();
    stubClient(AuditOS, RESULT);
    const suggestion = proposeEdit(AuditOS);

    const updated = await AuditOS.impactAgent.requestReasoning({
      engagementId: ENGAGEMENT_ID, suggestion: suggestion, impact: IMPACT,
      sectionLabel: 'Section III', editText: 'The system is hosted on GCP.'
    });

    assert.equal(updated.description, suggestion.description,
      'the proposed edit text is never rewritten by the agent');
    assert.equal(updated.status, AuditOS.suggestionService.STATUS.SUGGESTED,
      'and the decision is still pending — reasoning does not advance the lifecycle');
    assert.deepEqual(Array.from(updated.affectedReportSections), ['SEC-3']);
  });

  test('the reasoning is attributed to the provider', async function () {
    const AuditOS = await boot();
    stubClient(AuditOS, RESULT);
    const suggestion = proposeEdit(AuditOS);

    const updated = await AuditOS.impactAgent.requestReasoning({
      engagementId: ENGAGEMENT_ID, suggestion: suggestion, impact: IMPACT,
      sectionLabel: 'Section III', editText: 'x'
    });

    assert.equal(updated.impactReasonedBy, 'Google');
    assert.ok(updated.impactReasonedOn, 'and stamped, so the trail shows when');
  });

  test('the rewrite is recorded in the audit trail', async function () {
    const AuditOS = await boot();
    stubClient(AuditOS, RESULT);
    const suggestion = proposeEdit(AuditOS);

    await AuditOS.impactAgent.requestReasoning({
      engagementId: ENGAGEMENT_ID, suggestion: suggestion, impact: IMPACT,
      sectionLabel: 'Section III', editText: 'x'
    });

    const actions = AuditOS.auditService.listForEntity(suggestion.id, 'suggestions')
      .map(function (event) { return event.action; });
    assert.ok(actions.indexOf('suggestion-impact-reasoned') !== -1,
      'an agent rewriting advisory text is an audited write like any other');
  });

  // ---- Declining rather than guessing.

  test('a section generated from nothing is never reasoned about', async function () {
    const AuditOS = await boot();
    const calls = stubClient(AuditOS, RESULT);
    const suggestion = proposeEdit(AuditOS);

    const updated = await AuditOS.impactAgent.requestReasoning({
      engagementId: ENGAGEMENT_ID, suggestion: suggestion, impact: [],
      sectionLabel: 'Section I', editText: 'x'
    });

    assert.equal(updated, null, 'no upstream objects means no question to sharpen');
    assert.equal(calls.length, 0, 'and the model is never asked');
  });

  test('a suggestion is only reasoned about once', async function () {
    const AuditOS = await boot();
    const calls = stubClient(AuditOS, RESULT);
    const suggestion = proposeEdit(AuditOS);

    const first = await AuditOS.impactAgent.requestReasoning({
      engagementId: ENGAGEMENT_ID, suggestion: suggestion, impact: IMPACT, editText: 'x'
    });
    const second = await AuditOS.impactAgent.requestReasoning({
      engagementId: ENGAGEMENT_ID, suggestion: suggestion, impact: IMPACT, editText: 'x'
    });

    assert.ok(first);
    assert.equal(second, null);
    assert.equal(calls.length, 1, 'no repeat spend on advice already written');
  });

  test('an unreachable backend is checked once, never POSTed to', async function () {
    const AuditOS = await boot();
    const calls = stubClient(AuditOS, RESULT, false);
    const suggestion = proposeEdit(AuditOS);

    const updated = await AuditOS.impactAgent.requestReasoning({
      engagementId: ENGAGEMENT_ID, suggestion: suggestion, impact: IMPACT, editText: 'x'
    });

    assert.equal(updated, null);
    assert.equal(calls.length, 0);
  });

  test('a provider failure leaves the structural text in place', async function () {
    const AuditOS = await boot();
    stubClient(AuditOS, null);
    const suggestion = proposeEdit(AuditOS);
    const before = Array.from(suggestion.recommendations);

    const updated = await AuditOS.impactAgent.requestReasoning({
      engagementId: ENGAGEMENT_ID, suggestion: suggestion, impact: IMPACT, editText: 'x'
    });

    assert.equal(updated, null);
    assert.deepEqual(Array.from(reload(AuditOS, suggestion.id).recommendations), before);
  });

  // ---- The merge itself, as a pure function.

  test('mergeRecommendations keeps the structural line for an unanswered domain', function () {
    const AuditOS = loadClassicScripts([SCRIPTS.impactAgent]).AuditOS;
    const merged = AuditOS.impactAgent.mergeRecommendations(IMPACT, { evidence: 'Check the items.' });

    assert.deepEqual(Array.from(merged), [
      'Section III — Description of the System is generated from Walkthrough.',
      'Evidence: Check the items.'
    ], 'a domain the AI did not answer for never loses its guidance');
  });
};
