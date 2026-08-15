/**
 * AuditOS Narrative Agent
 * Release 2 AI Foundation — the Documentation agent's first landing point
 *
 * The orchestration between the recorded facts of a report section and the AI
 * draft of its prose: when to draft, what to draft from, and what becomes of
 * the result. It is the first implementation of the platform's agent pattern,
 * and deliberately a separate module from the three things it sits between —
 * `reportGenerationService` is a pure service that performs no writes,
 * `aiClient` is transport that holds no business rule, and the Reporting
 * workspace renders rather than originates state. Each further agent
 * (Walkthrough, Controls, Evidence, Testing, Findings) is this same shape with
 * different inputs and a different apply target.
 *
 * A draft never reaches the report on its own. The agent's output is a
 * Suggestion in the canonical Suggested → Reviewed → Approved → Applied
 * lifecycle, carrying the concrete Repository write to perform on Apply
 * (`applyTarget`). Only a human decision publishes the narrative, and only at
 * that point is the AI lineage recorded against the section — which is exactly
 * the contract `report-generation-service.js` states for this seam: "its output
 * still enters the report only through the Suggestion → Approval → Propagation
 * path, so human approval remains mandatory and nothing here writes directly."
 *
 * The agent is entirely optional. With no AI backend running, `requestDraft`
 * resolves to null, no suggestion is created, and the report renders exactly as
 * it does with no AI at all.
 *
 * Depends on nothing in components/, keeping the js → components boundary
 * one-way. Loaded as a classic script so the prototype runs directly from
 * file:///.../prototype/index.html with no build step or module loader.
 */
(function (global) {
  'use strict';

  var AuditOS = global.AuditOS = global.AuditOS || {};

  /** The suggestion category this agent files under (Coding Standards §30.11). */
  var CATEGORY = 'report-narrative';

  /** The section key whose prose this agent drafts. */
  var SECTION_KEY = 'system-description';

  /**
   * Drafts already requested this session, keyed engagementId::sectionId. A
   * workspace re-renders on every state change, so without this a single
   * approval decision would fire a fresh draft for every redraw.
   */
  var inFlight = {};

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function repository() { return AuditOS.repository || null; }
  function suggestions() { return AuditOS.suggestionService || null; }
  function client() { return AuditOS.aiClient || null; }

  function requestKey(engagementId, sectionId) {
    return String(engagementId) + '::' + String(sectionId);
  }

  /**
   * The suggestions this agent has already filed for one section, in any
   * lifecycle state. Matched on the apply target rather than on category alone,
   * so a suggestion is only ever attributed to the section it would actually
   * write to.
   */
  function draftsForSection(engagementId, sectionId) {
    var service = suggestions();
    var repo = repository();
    if (!service || !repo) {
      return [];
    }
    return asArray(service.list(repo, engagementId)).filter(function (suggestion) {
      var target = suggestion && suggestion.applyTarget;
      return Boolean(target) && target.entity === 'reports' && target.recordId === sectionId;
    });
  }

  /**
   * Whether a draft is already awaiting a human decision. A section with a
   * pending draft is not redrafted — the reviewer decides on what exists
   * before the agent proposes anything further.
   */
  function hasPendingDraft(engagementId, sectionId) {
    var service = suggestions();
    if (!service) {
      return false;
    }
    return draftsForSection(engagementId, sectionId).some(function (suggestion) {
      return suggestion.status === service.STATUS.SUGGESTED ||
        suggestion.status === service.STATUS.REVIEWED ||
        suggestion.status === service.STATUS.APPROVED;
    });
  }

  /**
   * The AI lineage declaration written against the section when a draft is
   * applied. Read by the canonical AI Lineage Service (`AuditOS.aiLineage`),
   * the same one Evidence and Controls render, so the section's generation
   * provenance appears with no presentation work of its own.
   *
   * `confidence` stays null: the model returns no calibrated confidence, and a
   * fabricated one would be exactly the kind of invented value this platform
   * refuses to render.
   */
  function buildLineage(result) {
    return {
      kind: 'ai-generated',
      generatedBy: result.provider || '',
      model: result.model || '',
      generatedAt: new Date().toISOString(),
      reasoning: 'Drafted from the recorded facts this section is generated from.',
      confidence: null
    };
  }

  AuditOS.narrativeAgent = {
    CATEGORY: CATEGORY,
    SECTION_KEY: SECTION_KEY,
    draftsForSection: draftsForSection,
    hasPendingDraft: hasPendingDraft,
    buildLineage: buildLineage,

    /** Clears the in-flight guard. Test seam; never called by the application. */
    resetRequestGuard: function () {
      inFlight = {};
    },

    /**
     * Requests an AI draft of one section's narrative and files it as a
     * Suggestion for human decision.
     *
     * Resolves to the stored suggestion, or to null when nothing was proposed —
     * no AI backend, no facts recorded, a draft already pending, a narrative
     * already applied, or any provider failure. Never rejects and never writes
     * to the report: the only state it creates is a suggestion awaiting review.
     */
    requestDraft: function (request) {
      var payload = request || {};
      var section = payload.section || {};
      var engagementId = payload.engagementId;
      var aiClient = client();
      var service = suggestions();
      var repo = repository();

      if (!engagementId || !section.id || !aiClient || !service || !repo) {
        return Promise.resolve(null);
      }
      if (section.key !== SECTION_KEY) {
        return Promise.resolve(null);
      }

      // Facts are the whole input. A section recording nothing has nothing to
      // draft from, and asking a model to write anyway is how invention starts.
      var blocks = asArray(section.blocks).filter(function (block) {
        return block && block.present && block.text;
      });
      if (blocks.length === 0) {
        return Promise.resolve(null);
      }

      if (section.narrative || hasPendingDraft(engagementId, section.id)) {
        return Promise.resolve(null);
      }

      var key = requestKey(engagementId, section.id);
      if (inFlight[key]) {
        return Promise.resolve(null);
      }
      inFlight[key] = true;

      // Availability is checked before the draft request, not instead of it.
      // The probe is memoized for the session, so the common case — no AI
      // backend running — costs one failed health check rather than a doomed
      // POST on every re-render of the workspace.
      return aiClient.isAvailable().then(function (available) {
        if (!available) {
          return null;
        }
        return aiClient.requestNarrative({
          engagementId: engagementId,
          sectionKey: section.key,
          blocks: blocks
        });
      }).then(function (result) {
        if (!result || !result.text) {
          return null;
        }
        // Re-checked after the round trip: a reviewer may have decided on
        // another draft, or a second render may have filed one, while the
        // request was in flight.
        if (hasPendingDraft(engagementId, section.id)) {
          return null;
        }
        return service.propose(repo, engagementId, {
          title: 'AI-drafted narrative — ' + (section.title || section.id),
          description: result.text,
          category: CATEGORY,
          workspaceId: 'reporting',
          // The provider that authored the prose, never the signed-in
          // reviewer — the audit trail must name the real author.
          suggestedBy: result.provider || 'AI',
          // What the Reporting inspector filters its section-scoped
          // suggestion list on.
          affectedReportSections: [section.id],
          auditReferences: [section.id],
          recommendations: [
            'Review the drafted paragraph against the recorded facts before approving.'
          ],
          applyTarget: {
            entity: 'reports',
            recordId: section.id,
            changes: {
              narrative: result.text,
              aiLineage: buildLineage(result)
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
