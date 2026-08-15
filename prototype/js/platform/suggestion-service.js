/**
 * AuditOS Suggestion Lifecycle Service
 * Engagement Operating System Foundation — GitHub Issue #36 (§9 Suggestion
 * Lifecycle / §13 AI Suggestions)
 *
 * Every AI suggestion follows Suggested → Reviewed → Approved → Applied (or
 * Rejected / Modified). Users without the `suggestions.decide` capability
 * may review, comment, and recommend; permissioned users may approve,
 * reject, modify, and apply — the same hidden-not-disabled permission
 * pattern the Approval Workflow established (Issue #34 —
 * `js/workspaces/global-approvals.js`), reused here for a second decision
 * surface rather than re-implemented. AI never writes directly: every
 * transition is a simulated Repository write the acting session performs,
 * and every write is automatically audited.
 *
 * Applying a suggestion additionally publishes the SynchronizationBus's
 * propagation chain (Issue #36 §12): an applied suggestion is exactly the
 * kind of walkthrough-originated change downstream workspaces react to.
 *
 * Depends on nothing in components/, keeping the js → components boundary
 * one-way. Loaded as a classic script so the prototype runs directly from
 * file:///.../prototype/index.html with no build step or module loader.
 */
(function (global) {
  'use strict';

  var AuditOS = global.AuditOS = global.AuditOS || {};

  /** Suggestion lifecycle status vocabulary (Issue #36 §9). */
  var STATUS = {
    SUGGESTED: 'Suggested',
    REVIEWED: 'Reviewed',
    APPROVED: 'Approved',
    REJECTED: 'Rejected',
    MODIFIED: 'Modified',
    APPLIED: 'Applied'
  };

  /** The capability that gates Approve / Reject / Modify / Apply (Permission Foundation). */
  var DECIDE_CAPABILITY = 'suggestions.decide';

  /** Decision → { status, actorField, dateField, action }. */
  var DECISIONS = {
    approve: { status: STATUS.APPROVED, actorField: 'approvedByLabel', dateField: 'approvedOn', action: 'suggestion-approved' },
    reject: { status: STATUS.REJECTED, actorField: 'approvedByLabel', dateField: 'approvedOn', action: 'suggestion-rejected' },
    modify: { status: STATUS.MODIFIED, actorField: 'approvedByLabel', dateField: 'approvedOn', action: 'suggestion-modified' },
    apply: { status: STATUS.APPLIED, actorField: 'appliedByLabel', dateField: 'appliedOn', action: 'suggestion-applied' }
  };

  /** Returns the value when it is an array, otherwise an empty array. */
  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  /** Today's date in the dataset's own ISO date convention. */
  function todayIso() {
    return new Date().toISOString().slice(0, 10);
  }

  /** The acting session's label, for lifecycle history entries (never an invented user). */
  function sessionLabel() {
    var permissions = AuditOS.permissions;
    return permissions && typeof permissions.getSessionInfo === 'function'
      ? permissions.getSessionInfo().label : '';
  }

  /** The dataset id an engagement's suggestions document lives under, or null. */
  function resolveDatasetId(repository, engagementId) {
    if (!repository || !engagementId) {
      return null;
    }
    var datasets = repository.suggestions.datasetsForEngagement(engagementId);
    return datasets.length > 0 ? datasets[0] : null;
  }

  /** Every recorded suggestion for an engagement, most recently suggested first. */
  function list(repository, engagementId) {
    var datasetId = resolveDatasetId(repository, engagementId);
    if (!datasetId) {
      return [];
    }
    return repository.suggestions.list({ datasetId: datasetId }).sort(function (a, b) {
      return String(b.suggestedOn || '').localeCompare(String(a.suggestedOn || ''));
    });
  }

  /** The suggestions scoped to one Team. */
  function listForTeam(repository, engagementId, teamId) {
    return list(repository, engagementId).filter(function (suggestion) {
      return suggestion.teamId === teamId;
    });
  }

  /** The suggestions still awaiting a decision (Suggested or Reviewed). */
  function listPending(repository, engagementId) {
    return list(repository, engagementId).filter(function (suggestion) {
      return suggestion.status === STATUS.SUGGESTED || suggestion.status === STATUS.REVIEWED;
    });
  }

  /**
   * Records a comment or recommendation on a suggestion — available to
   * every session, no capability gate (Issue #36 §9 — "users without
   * permissions may review, comment, recommend").
   */
  function comment(repository, engagementId, suggestion, text) {
    if (!repository || !suggestion || !text) {
      return null;
    }
    var datasetId = resolveDatasetId(repository, engagementId);
    if (!datasetId) {
      return null;
    }
    var auditService = AuditOS.auditService;
    var comments = asArray(suggestion.comments).concat([{ author: sessionLabel(), on: todayIso(), text: text }]);
    return repository.suggestions.update(suggestion.id, { comments: comments }, {
      datasetId: datasetId,
      action: 'suggestion-commented',
      reason: text,
      engagementId: engagementId,
      workspaceId: 'walkthroughs',
      correlationId: auditService ? auditService.newCorrelationId() : null
    });
  }

  /**
   * Marks a suggestion Reviewed — available to every session, no capability
   * gate. A suggestion not already Suggested is left alone (review only
   * advances the lifecycle forward, never backward).
   */
  function review(repository, engagementId, suggestion, note) {
    if (!repository || !suggestion) {
      return null;
    }
    var datasetId = resolveDatasetId(repository, engagementId);
    if (!datasetId || suggestion.status !== STATUS.SUGGESTED) {
      return null;
    }
    var auditService = AuditOS.auditService;
    var changes = { status: STATUS.REVIEWED, reviewedByLabel: sessionLabel(), reviewedOn: todayIso() };
    if (note) {
      changes.comments = asArray(suggestion.comments).concat([{ author: sessionLabel(), on: todayIso(), text: note }]);
    }
    return repository.suggestions.update(suggestion.id, changes, {
      datasetId: datasetId,
      action: 'suggestion-reviewed',
      reason: note || null,
      engagementId: engagementId,
      workspaceId: 'walkthroughs',
      correlationId: auditService ? auditService.newCorrelationId() : null
    });
  }

  /**
   * Records a human-proposed change as a new Suggestion (Issue #37 Part 8):
   * production state is never edited directly — the proposal enters the
   * same Suggested → Reviewed → Approved → Applied lifecycle as an AI
   * suggestion, optionally carrying the concrete Repository write to
   * perform on Apply (`applyTarget: { entity, recordId, changes }`).
   * Creating the record is itself an audited Repository write. Returns the
   * stored suggestion, or null when the engagement has no suggestions
   * dataset to hold it.
   */
  function propose(repository, engagementId, proposal) {
    if (!repository || !engagementId || !proposal || !proposal.title) {
      return null;
    }
    var datasetId = resolveDatasetId(repository, engagementId);
    if (!datasetId) {
      return null;
    }
    var auditService = AuditOS.auditService;
    var idService = AuditOS.idService;
    var record = {
      id: idService ? idService.next('SUG-' + engagementId) : 'SUG-' + engagementId + '-' + Date.now(),
      engagementId: engagementId,
      teamId: proposal.teamId || '',
      title: proposal.title,
      description: proposal.description || '',
      category: proposal.category || 'change-proposal',
      status: STATUS.SUGGESTED,
      confidence: null,
      // Attribution is the proposer's to declare: an AI agent files under its
      // provider, a person under the acting session. Recording a drafting
      // agent's proposal against the reviewer who happened to be signed in
      // would put a false author in an immutable audit trail.
      suggestedBy: proposal.suggestedBy || sessionLabel() || 'User',
      suggestedOn: todayIso(),
      reviewedByLabel: '',
      reviewedOn: '',
      approvedByLabel: '',
      approvedOn: '',
      appliedByLabel: '',
      appliedOn: '',
      comments: [],
      recommendations: asArray(proposal.recommendations),
      affectedRequirements: asArray(proposal.affectedRequirements),
      affectedControls: asArray(proposal.affectedControls),
      affectedReportSections: asArray(proposal.affectedReportSections),
      auditReferences: asArray(proposal.auditReferences),
      applyTarget: proposal.applyTarget || null
    };
    return repository.suggestions.create(record, {
      datasetId: datasetId,
      action: 'suggestion-proposed',
      reason: proposal.description || proposal.title,
      engagementId: engagementId,
      workspaceId: proposal.workspaceId || 'requirements',
      correlationId: auditService ? auditService.newCorrelationId() : null
    });
  }

  /**
   * Records a decision — approve, reject, modify, or apply — gated by the
   * `suggestions.decide` capability (Issue #36 §9). Callers check
   * `AuditOS.permissions.explainDenial(DECIDE_CAPABILITY)` before invoking
   * this, exactly as Global Approvals gates `approvals.decide` (Issue #34);
   * this service performs the write and trusts the caller's gate, the same
   * division of responsibility every other Repository-backed action uses.
   */
  function decide(repository, engagementId, suggestion, decisionId, note) {
    var decision = DECISIONS[decisionId];
    if (!repository || !suggestion || !decision) {
      return null;
    }
    var datasetId = resolveDatasetId(repository, engagementId);
    if (!datasetId) {
      return null;
    }

    var changes = {};
    changes.status = decision.status;
    changes[decision.actorField] = sessionLabel();
    changes[decision.dateField] = todayIso();
    if (note) {
      changes.comments = asArray(suggestion.comments).concat([{ author: sessionLabel(), on: todayIso(), text: note }]);
    }

    var auditService = AuditOS.auditService;
    var correlationId = auditService ? auditService.newCorrelationId() : null;
    var updated = repository.suggestions.update(suggestion.id, changes, {
      datasetId: datasetId,
      action: decision.action,
      reason: note || null,
      engagementId: engagementId,
      workspaceId: 'walkthroughs',
      correlationId: correlationId
    });

    // A human-proposed change (Issue #37 Part 8) carries the concrete write
    // to perform once Applied — the only place production state changes,
    // under the same correlation id as the lifecycle transition so the
    // audit chain reads Genesis → decision → applied state.
    if (decisionId === 'apply' && updated && suggestion.applyTarget && suggestion.applyTarget.entity) {
      var target = suggestion.applyTarget;
      var entityRepository = repository[target.entity];
      if (entityRepository && target.recordId && target.changes) {
        var targetDatasets = entityRepository.datasetsForEngagement(engagementId);
        entityRepository.update(target.recordId, target.changes, {
          datasetId: targetDatasets.length > 0 ? targetDatasets[0] : null,
          action: 'suggestion-apply',
          reason: 'Applied suggestion: ' + suggestion.title,
          engagementId: engagementId,
          workspaceId: 'requirements',
          correlationId: correlationId
        });
      }
    }

    if (decisionId === 'apply' && updated && AuditOS.synchronizationBus) {
      AuditOS.synchronizationBus.propagate(AuditOS.synchronizationBus.EVENT_TYPES.WALKTHROUGH_UPDATED, {
        engagementId: engagementId,
        teamId: suggestion.teamId,
        workspaceId: 'walkthroughs',
        reason: 'Suggestion applied: ' + suggestion.title
      });
    }

    return updated;
  }

  AuditOS.suggestionService = {
    STATUS: STATUS,
    DECIDE_CAPABILITY: DECIDE_CAPABILITY,
    list: list,
    listForTeam: listForTeam,
    listPending: listPending,
    comment: comment,
    review: review,
    propose: propose,
    decide: decide
  };
})(window);
