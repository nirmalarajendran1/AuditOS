/**
 * AuditOS Report Propagation Service
 * Living Reporting & Operational Findings — GitHub Issue #41 (Report Editing /
 * Propagation)
 *
 * The report is never written directly. Every edit travels one path:
 *
 *   Edit → AI analyzes impact → Suggestions generated → User approves →
 *   Propagation → Report regenerated
 *
 * This service owns the two ends of that path that are not already built. The
 * middle — the Suggested → Reviewed → Approved → Applied lifecycle, its
 * permission gate, and its audited Repository writes — is the canonical
 * Suggestion Lifecycle Service (js/platform/suggestion-service.js), reused as
 * is. There is no second suggestion workflow.
 *
 * Impact analysis (`analyzeImpact`) reads which operational domains the edited
 * section is genuinely generated from — the Report Generation Service's own
 * lineage — and names only those. A section that draws on nothing upstream
 * proposes nothing upstream: "only affected objects receive suggestions."
 *
 * Propagation (`propagate`) walks the Synchronization Bus's
 * `REPORT_PROPAGATION_CHAIN` upstream from the report —
 *
 *   Reporting → Findings → Testing → Controls → Evidence → Walkthrough
 *
 * — publishing one event per affected hop and recording each in the Audit Log
 * under one correlation id, so an approved report edit is inspectable end to
 * end. Hops the edit does not affect are skipped rather than published as
 * no-ops.
 *
 * Release 2 extension point: `analyzeImpact` returns the *structural* impact
 * the recorded lineage supports. Release 2 replaces `describeImpact` — the one
 * clearly marked function below — with the AI's own reasoning about what the
 * edit means for each upstream object. The proposal shape, the approval gate,
 * and the propagation chain are unchanged when that happens.
 *
 * Depends on nothing in components/, keeping the js → components boundary
 * one-way. Loaded as a classic script so the prototype runs directly from
 * file:///.../prototype/index.html with no build step or module loader.
 */
(function (global) {
  'use strict';

  var AuditOS = global.AuditOS = global.AuditOS || {};

  /**
   * The upstream propagation order (Issue #41 — Propagation). Each entry maps
   * one report-lineage domain to the Synchronization Bus event that notifies
   * its workspace and to the Workspace Registry id the suggestion is filed
   * against.
   */
  var PROPAGATION_TARGETS = [
    { domain: 'findings',    label: 'Findings',    workspaceId: 'findings',    event: 'findings-updated' },
    { domain: 'testing',     label: 'Testing',     workspaceId: 'testing',     event: 'testing-updated' },
    { domain: 'controls',    label: 'Controls',    workspaceId: 'controls',    event: 'controls-updated' },
    { domain: 'evidence',    label: 'Evidence',    workspaceId: 'evidence',    event: 'evidence-updated' },
    { domain: 'walkthrough', label: 'Walkthrough', workspaceId: 'walkthrough', event: 'walkthrough-updated' }
  ];

  /** The suggestion category every report-originated proposal carries. */
  var CATEGORY = 'report-edit';

  /**
   * The AI-drafted narrative category (`js/services/narrative-agent.js`).
   * A drafted paragraph is a proposed change to a report section, so it
   * travels this same Suggestion → Approval → Propagation path and appears in
   * the same registers — but it keeps its own category so the audit trail
   * distinguishes prose an agent drafted from an edit a person proposed.
   */
  var NARRATIVE_CATEGORY = 'report-narrative';

  /** Every category that originates against a report section. */
  var REPORT_CATEGORIES = [CATEGORY, NARRATIVE_CATEGORY];

  /** Returns the value when it is an array, otherwise an empty array. */
  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  /** The Suggestion Lifecycle Service, resolved at call time so load order stays flexible. */
  function suggestions() {
    return AuditOS.suggestionService || null;
  }

  /** The Synchronization Bus, resolved at call time. */
  function bus() {
    return AuditOS.synchronizationBus || null;
  }

  /** The propagation target registered for a lineage domain, or null. */
  function targetFor(domain) {
    for (var index = 0; index < PROPAGATION_TARGETS.length; index += 1) {
      if (PROPAGATION_TARGETS[index].domain === domain) {
        return PROPAGATION_TARGETS[index];
      }
    }
    return null;
  }

  /**
   * Release 2 extension point — AI impact reasoning.
   *
   * Release 1 states the structural relationship the recorded lineage supports:
   * this section is generated from that domain, so an edit to the section is a
   * question for the objects underneath it. Release 2 replaces this one
   * function with the AI's own account of what the edit implies, drawn from the
   * edited text. Nothing else in the path changes: the description still
   * becomes a Suggestion that a human approves before anything moves.
   */
  function describeImpact(section, target, editText) {
    var title = section && section.title ? section.title : 'the report section';
    var note = editText ? ' Proposed change: ' + editText : '';
    return 'Section ' + (section && section.numeral ? section.numeral + ' — ' : '') + title +
      ' is generated from ' + target.label + '. Review whether this edit requires a corresponding change to the ' +
      target.label.toLowerCase() + ' it draws on.' + note;
  }

  /**
   * The upstream objects an edit to one report section affects: the section's
   * own recorded lineage domains, mapped to their propagation targets and kept
   * in the canonical upstream order. A section generated from nothing (the
   * manually authored Sections I and II, or Section V's entity-supplied
   * content) affects nothing upstream and yields an empty list — never a
   * fabricated dependency.
   */
  function analyzeImpact(section, editText) {
    var lineage = asArray(section && section.lineage);
    var domains = {};
    lineage.forEach(function (node) {
      if (node && node.domain) {
        domains[node.domain] = node;
      }
    });
    return PROPAGATION_TARGETS.filter(function (target) {
      return Object.prototype.hasOwnProperty.call(domains, target.domain);
    }).map(function (target) {
      var node = domains[target.domain];
      return {
        domain: target.domain,
        label: target.label,
        workspaceId: target.workspaceId,
        event: target.event,
        count: node.count || 0,
        present: Boolean(node.present),
        description: describeImpact(section, target, editText)
      };
    });
  }

  /**
   * Records a report edit as a Suggestion (Issue #41 — "No direct writes").
   * The proposal carries the edited section, the proposed text, and the
   * upstream objects the impact analysis named, then enters the canonical
   * Suggested → Reviewed → Approved → Applied lifecycle, where a permissioned
   * human decides. Returns `{ suggestion, impact }`, or null when the
   * engagement has no suggestions dataset to hold the proposal.
   */
  function proposeEdit(repository, engagementId, section, editText, options) {
    var service = suggestions();
    if (!service || !repository || !engagementId || !section) {
      return null;
    }
    var settings = options || {};
    var impact = analyzeImpact(section, editText);
    var sectionLabel = 'Section ' + (section.numeral || section.id) + ' — ' + (section.title || '');

    var suggestion = service.propose(repository, engagementId, {
      title: settings.title || ('Report edit: ' + sectionLabel),
      description: editText || settings.description || '',
      category: CATEGORY,
      workspaceId: 'reporting',
      recommendations: impact.map(function (entry) { return entry.description; }),
      affectedControls: [],
      affectedRequirements: []
    });
    if (!suggestion) {
      return null;
    }

    // The proposal records which report section it edits and which upstream
    // objects it reaches, so the approval surface shows the blast radius before
    // anyone decides. The suggestions schema already declares
    // `affectedReportSections`; this is the first writer to populate it.
    var datasets = repository.suggestions.datasetsForEngagement(engagementId);
    var auditService = AuditOS.auditService;
    var stored = repository.suggestions.update(suggestion.id, {
      affectedReportSections: [section.id],
      propagationTargets: impact.map(function (entry) { return entry.workspaceId; })
    }, {
      datasetId: datasets.length > 0 ? datasets[0] : null,
      action: 'report-edit-proposed',
      reason: sectionLabel,
      engagementId: engagementId,
      workspaceId: 'reporting',
      correlationId: auditService ? auditService.newCorrelationId() : null
    }) || suggestion;

    return { suggestion: stored, impact: impact };
  }

  /**
   * Propagates an approved report edit upstream (Issue #41 — Propagation).
   * Publishes the report hop, then one hop per affected upstream object in
   * canonical order, each audited under a shared correlation id. Objects the
   * edit does not affect are skipped, never published as no-ops. Returns
   * `{ hops, correlationId }`, mirroring the Synchronization Bus's own
   * propagation result.
   */
  function propagate(engagementId, section, impact, reason) {
    var channel = bus();
    if (!channel) {
      return { hops: [], correlationId: null };
    }
    var affected = asArray(impact);
    var events = [channel.EVENT_TYPES.REPORT_UPDATED].concat(
      affected.map(function (entry) { return entry.event; }));
    var chain = channel.REPORT_PROPAGATION_CHAIN.filter(function (event) {
      return events.indexOf(event) !== -1;
    });
    return channel.propagateFrom(chain, channel.EVENT_TYPES.REPORT_UPDATED, {
      engagementId: engagementId,
      workspaceId: 'reporting',
      reason: reason || ('Report edit propagated from ' +
        (section && section.title ? section.title : 'the report'))
    });
  }

  /**
   * The report-originated suggestions currently in flight for an engagement,
   * newest first — the Reporting workspace's right-rail queue. Reads through
   * the canonical Suggestion Lifecycle Service; no second store.
   */
  function listEditSuggestions(repository, engagementId, sectionId) {
    var service = suggestions();
    if (!service || !repository || !engagementId) {
      return [];
    }
    return service.list(repository, engagementId).filter(function (suggestion) {
      if (REPORT_CATEGORIES.indexOf(suggestion.category) === -1) {
        return false;
      }
      if (!sectionId) {
        return true;
      }
      return asArray(suggestion.affectedReportSections).indexOf(sectionId) !== -1;
    });
  }

  /**
   * The report-originated suggestions still awaiting a decision — the
   * "pending report approvals" the Reporting workspace owns now that the
   * standalone Work Queue is gone (Issue #41).
   */
  function listPendingApprovals(repository, engagementId) {
    var service = suggestions();
    if (!service) {
      return [];
    }
    return listEditSuggestions(repository, engagementId, null).filter(function (suggestion) {
      return suggestion.status === service.STATUS.SUGGESTED ||
        suggestion.status === service.STATUS.REVIEWED;
    });
  }

  AuditOS.reportPropagationService = {
    PROPAGATION_TARGETS: PROPAGATION_TARGETS,
    CATEGORY: CATEGORY,
    NARRATIVE_CATEGORY: NARRATIVE_CATEGORY,
    REPORT_CATEGORIES: REPORT_CATEGORIES,

    targetFor: targetFor,
    analyzeImpact: analyzeImpact,
    proposeEdit: proposeEdit,
    propagate: propagate,
    listEditSuggestions: listEditSuggestions,
    listPendingApprovals: listPendingApprovals,

    /**
     * Release 2 extension point — see `describeImpact`. Exposed so a Release 2
     * AI module replaces exactly one function and nothing else in this service.
     */
    describeImpact: describeImpact
  };
})(window);
