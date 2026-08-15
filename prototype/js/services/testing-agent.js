/**
 * AuditOS Testing Agent
 * Release 2 AI Foundation — the third agent, on the Testing workspace's
 * reserved AI advisory
 *
 * Drafts the test procedure for a control whose workpaper records none — 121
 * of the demo dataset's 544 workpapers, each with a linked control that does
 * carry a real description. The procedure is drawn from that description and
 * nothing else: what to inspect, against which control, to establish what.
 *
 * The distinction this agent has to hold is between describing a test and
 * performing one. A procedure says "inspect the configuration to determine
 * whether access was restricted"; a result says whether it was. Only the first
 * is drafted here, and the backend refuses a draft that cites a criterion or
 * control it was never given — the error a reviewer is least likely to catch
 * by eye, because a plausible-looking criterion reference reads as researched
 * rather than invented.
 *
 * Governance is the Narrative Agent's, unchanged: the draft is a Suggestion
 * carrying the concrete write to perform on Apply, and only a human decision
 * puts it on the workpaper. With no AI backend the workspace renders exactly
 * as it does today — a workpaper with no recorded procedure says so.
 *
 * Depends on nothing in components/, keeping the js → components boundary
 * one-way. Loaded as a classic script so the prototype runs directly from
 * file:///.../prototype/index.html with no build step or module loader.
 */
(function (global) {
  'use strict';

  var AuditOS = global.AuditOS = global.AuditOS || {};

  /** The suggestion category this agent files under. */
  var CATEGORY = 'test-procedure';

  /** Drafts already requested this session, keyed engagementId::testId. */
  var inFlight = {};

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function repository() { return AuditOS.repository || null; }
  function suggestions() { return AuditOS.suggestionService || null; }
  function client() { return AuditOS.aiClient || null; }

  /**
   * The suggestions already filed against one workpaper, in any lifecycle
   * state. Matched on the apply target so a suggestion is only attributed to
   * the record it would actually write to.
   */
  function draftsForTest(engagementId, testId) {
    var service = suggestions();
    var repo = repository();
    if (!service || !repo) {
      return [];
    }
    return asArray(service.list(repo, engagementId)).filter(function (suggestion) {
      var target = suggestion && suggestion.applyTarget;
      return Boolean(target) && target.entity === 'testing' && target.recordId === testId;
    });
  }

  /** Whether a draft for this workpaper is already awaiting a decision. */
  function hasPendingDraft(engagementId, testId) {
    var service = suggestions();
    if (!service) {
      return false;
    }
    return draftsForTest(engagementId, testId).some(function (suggestion) {
      return suggestion.status === service.STATUS.SUGGESTED ||
        suggestion.status === service.STATUS.REVIEWED ||
        suggestion.status === service.STATUS.APPROVED;
    });
  }

  /**
   * The AI lineage written against the workpaper when a draft is applied, read
   * by the canonical AI Lineage Service. `confidence` stays null: the model
   * returns none, and a fabricated one would be the sort of invented value the
   * platform refuses to render.
   */
  function buildLineage(result, control) {
    return {
      kind: 'ai-generated',
      generatedBy: result.provider || '',
      model: result.model || '',
      generatedAt: new Date().toISOString(),
      reasoning: 'Drafted from the description of control ' +
        ((control && control.controlCode) || (control && control.id) || 'the linked control') + '.',
      confidence: null
    };
  }

  AuditOS.testingAgent = {
    CATEGORY: CATEGORY,
    draftsForTest: draftsForTest,
    hasPendingDraft: hasPendingDraft,
    buildLineage: buildLineage,

    /** Clears the in-flight guard. Test seam; never called by the application. */
    resetRequestGuard: function () {
      inFlight = {};
    },

    /**
     * Requests a drafted test procedure for one workpaper and files it as a
     * Suggestion for human decision.
     *
     * Resolves to the stored suggestion, or to null when nothing was proposed —
     * no AI backend, a procedure already recorded, no linked control, a control
     * with no description to draft from, a draft already pending, or any
     * provider or validation failure. Never rejects, and never writes to the
     * workpaper: the only state it creates is a suggestion awaiting review.
     */
    requestDraft: function (request) {
      var payload = request || {};
      var test = payload.test || {};
      var control = payload.control || null;
      var engagementId = payload.engagementId;
      var aiClient = client();
      var service = suggestions();
      var repo = repository();

      if (!engagementId || !test.id || !aiClient || !service || !repo) {
        return Promise.resolve(null);
      }

      // A workpaper that already records a procedure is left alone: the
      // recorded one is the auditor's, and an agent does not overwrite it.
      var recorded = test.testProcedure || test.procedure;
      if (typeof recorded === 'string' && recorded.trim()) {
        return Promise.resolve(null);
      }

      // The control's description is the whole input. Without one there is
      // nothing to draft from, and asking anyway is how invention starts.
      var description = control && (control.descriptionText || control.description);
      if (!control || typeof description !== 'string' || !description.trim()) {
        return Promise.resolve(null);
      }

      if (hasPendingDraft(engagementId, test.id)) {
        return Promise.resolve(null);
      }

      var key = String(engagementId) + '::' + String(test.id);
      if (inFlight[key]) {
        return Promise.resolve(null);
      }
      inFlight[key] = true;

      return aiClient.isAvailable().then(function (available) {
        if (!available) {
          return null;
        }
        return aiClient.requestProcedure({
          engagementId: engagementId,
          testId: test.id,
          controlCode: control.controlCode || control.id || '',
          controlTitle: control.title || '',
          controlDescription: description,
          criteriaIds: asArray(control.criteriaIds)
        });
      }).then(function (result) {
        if (!result || !result.text) {
          return null;
        }
        // Re-checked after the round trip: a reviewer may have decided on
        // another draft while the request was in flight.
        if (hasPendingDraft(engagementId, test.id)) {
          return null;
        }
        return service.propose(repo, engagementId, {
          title: 'AI-drafted test procedure — ' + (control.controlCode || test.id),
          description: result.text,
          category: CATEGORY,
          workspaceId: 'testing',
          suggestedBy: result.provider || 'AI',
          // What the Testing inspector filters its workpaper-scoped suggestion
          // list on (`deriveWorkpaperSuggestions` matches either).
          auditReferences: [test.id, control.controlCode].filter(Boolean),
          affectedControls: [control.id].filter(Boolean),
          recommendations: [
            'Review the drafted procedure against the control description before approving.'
          ],
          applyTarget: {
            entity: 'testing',
            recordId: test.id,
            changes: {
              testProcedure: result.text,
              aiLineage: buildLineage(result, control)
            }
          }
        });
      }).catch(function () {
        return null;
      }).then(function (suggestion) {
        delete inFlight[key];
        return suggestion;
      });
    }
  };
})(window);
