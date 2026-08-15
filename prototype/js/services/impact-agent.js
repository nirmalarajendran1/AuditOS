/**
 * AuditOS Impact Agent
 * Release 2 AI Foundation — the second agent, on the `describeImpact` seam
 *
 * When a user proposes an edit to a report section, the platform records which
 * upstream objects that section is generated from and asks the reviewer to
 * consider each one. `report-propagation-service.js` states that relationship
 * structurally — "Section III is generated from Evidence; review whether this
 * edit requires a corresponding change" — which is true but says the same thing
 * about every edit. This agent replaces it with reasoning about the actual
 * edit: what, specifically, should the reviewer look at.
 *
 * It differs from the Narrative Agent in one way worth being precise about: it
 * proposes no change to anything. Its output is the advisory text on an edit
 * suggestion a human is already being asked to decide on — it sharpens the
 * question rather than adding a second one to answer. The edit remains the only
 * thing under approval, and the report is untouched either way. That is why the
 * upgrade is applied to the suggestion in place rather than filed as a
 * suggestion of its own: a proposal about a proposal would be governance
 * theatre, not governance.
 *
 * Everything degrades to the structural description. With no AI backend, a
 * refused draft, or any failure at all, the suggestion keeps exactly the text
 * `describeImpact` already gave it, and the edit path behaves as it always has.
 *
 * Depends on nothing in components/, keeping the js → components boundary
 * one-way. Loaded as a classic script so the prototype runs directly from
 * file:///.../prototype/index.html with no build step or module loader.
 */
(function (global) {
  'use strict';

  var AuditOS = global.AuditOS = global.AuditOS || {};

  /** Suggestions already upgraded this session, keyed by suggestion id. */
  var upgraded = {};

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function repository() { return AuditOS.repository || null; }
  function client() { return AuditOS.aiClient || null; }
  function suggestionsService() { return AuditOS.suggestionService || null; }

  /**
   * The recommendation lines rewritten from the AI's reasoning, in the order
   * the impact analysis produced them. A domain the AI did not answer for keeps
   * its structural line — the backend refuses partial answers, so this is a
   * belt-and-braces guard rather than an expected path.
   */
  function mergeRecommendations(impact, reasoningByDomain) {
    return asArray(impact).map(function (entry) {
      var reasoning = reasoningByDomain[entry.domain];
      return reasoning ? entry.label + ': ' + reasoning : entry.description;
    });
  }

  AuditOS.impactAgent = {
    mergeRecommendations: mergeRecommendations,

    /** Clears the per-session guard. Test seam; never called by the application. */
    resetRequestGuard: function () {
      upgraded = {};
    },

    /**
     * Upgrades one edit suggestion's advisory text with AI reasoning.
     *
     * Resolves to the updated suggestion, or to null when nothing was changed —
     * no AI backend, no upstream objects, an already-upgraded suggestion, or
     * any provider or validation failure. Never rejects. The suggestion's
     * lifecycle state, its edited text, and the report itself are untouched:
     * the only field this writes is the advisory `recommendations` a reviewer
     * reads while deciding.
     */
    requestReasoning: function (request) {
      var payload = request || {};
      var suggestion = payload.suggestion;
      var impact = asArray(payload.impact);
      var engagementId = payload.engagementId;
      var aiClient = client();
      var repo = repository();

      if (!engagementId || !suggestion || !suggestion.id || !aiClient || !repo) {
        return Promise.resolve(null);
      }
      // A section generated from nothing (the manually authored Sections I and
      // II) affects nothing upstream. There is no question to sharpen.
      if (impact.length === 0) {
        return Promise.resolve(null);
      }
      if (upgraded[suggestion.id]) {
        return Promise.resolve(null);
      }
      upgraded[suggestion.id] = true;

      return aiClient.isAvailable().then(function (available) {
        if (!available) {
          return null;
        }
        return aiClient.requestImpact({
          engagementId: engagementId,
          sectionLabel: payload.sectionLabel || '',
          editText: payload.editText || '',
          targets: impact.map(function (entry) {
            return {
              domain: entry.domain,
              label: entry.label,
              count: entry.count,
              present: entry.present
            };
          })
        });
      }).then(function (result) {
        if (!result || result.impacts.length === 0) {
          return null;
        }

        var byDomain = {};
        result.impacts.forEach(function (entry) { byDomain[entry.domain] = entry.reasoning; });

        var service = suggestionsService();
        var datasets = repo.suggestions.datasetsForEngagement(engagementId);
        if (!service || datasets.length === 0) {
          return null;
        }

        // Recorded as an ordinary audited Repository write, attributed to the
        // provider rather than the session, so the trail shows plainly that the
        // advisory text on this suggestion was authored by an agent.
        return repo.suggestions.update(suggestion.id, {
          recommendations: mergeRecommendations(impact, byDomain),
          impactReasonedBy: result.provider || 'AI',
          impactReasonedOn: new Date().toISOString()
        }, {
          datasetId: datasets[0],
          action: 'suggestion-impact-reasoned',
          reason: 'AI reasoning applied to the impact analysis of this edit',
          engagementId: engagementId,
          workspaceId: 'reporting',
          correlationId: AuditOS.auditService ? AuditOS.auditService.newCorrelationId() : null
        });
      }).catch(function () {
        return null;
      });
    }
  };
})(window);
