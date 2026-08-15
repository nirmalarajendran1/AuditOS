/**
 * AuditOS Report Generation Service
 * Living Reporting & Operational Findings — GitHub Issue #41
 *
 * The one place the engagement's report is assembled. The report exists from
 * engagement creation and evolves continuously: every operational workspace —
 * Walkthrough, Evidence, Controls, Testing, and approved Findings — feeds the
 * same five-section document, and only the sections a change actually touches
 * regenerate. There is no "generate the report at the end" step and no full
 * regeneration.
 *
 * The five canonical sections (Issue #41 — Report Sections):
 *
 *   I    Management Assertion            — supplied by the entity's management
 *   II   Independent Auditor Report      — the service auditor's opinion
 *   III  System Description              — generated continuously from
 *                                          Walkthrough + Evidence + Controls +
 *                                          Testing + approved Findings
 *   IV   Testing Results                 — generated directly from Testing:
 *                                          control, procedure, evidence,
 *                                          result, conclusion, linked findings
 *   V    Entity Information (Not Audited)— information supplied by the entity
 *                                          but outside audit scope, labelled
 *                                          as not audited everywhere it appears
 *
 * Faithful generation, never fabrication. Every block this service emits is
 * read from data the engagement actually records:
 *
 *  - Sections I–IV bind to the `sections` records the report document declares
 *    (SEC-1…SEC-4 in the current datasets), keeping their recorded `source`,
 *    `editable`, `included`, and `status` exactly as authored.
 *  - Section IV's result rows are the engagement's real test workpapers.
 *  - Section V binds to the entity-supplied registers the report document
 *    already carries — Complementary User Entity Controls (`cuecs`),
 *    Complementary Subservice Organization Controls (`csocs`), and the IPE
 *    procedures (`ipeProcedures`). Those are, by definition, information the
 *    entity supplies that the auditor does not test, which is precisely what
 *    Section V is. Nothing is invented to fill it: a dataset that records none
 *    of them renders Section V's honest empty state.
 *  - A canonical section the dataset does not declare renders as "not recorded
 *    in this report" — never as invented narrative.
 *
 * AI Lineage (Issue #41 — AI Lineage): every generated section carries the
 * operational domains it was generated from, each with its real, current count
 * and the workspace it navigates to, so a reader can walk from a paragraph
 * back to the source object.
 *
 * Release 1 / Release 2 seam: this service derives the report's *structure and
 * bindings* from recorded state. `draftNarrative` — the one clearly marked
 * extension point below — now returns AI-authored prose for the narrative
 * sections, but only prose a human has approved: the drafting itself belongs to
 * `js/services/narrative-agent.js`, which files every draft as a Suggestion.
 * Every other contract here (section identity, lineage, regeneration scoping,
 * status vocabulary) is unchanged by that, and human approval stays mandatory
 * because narrative changes still travel the Suggestion → Approval →
 * Propagation path (see report-propagation-service.js).
 *
 * Pure derivation: no DOM, no `AuditOS.state`, no writes. Depends on nothing in
 * components/, keeping the js → components boundary one-way. Loaded as a
 * classic script so the prototype runs directly from
 * file:///.../prototype/index.html with no build step or module loader.
 */
(function (global) {
  'use strict';

  var AuditOS = global.AuditOS = global.AuditOS || {};

  /** Presentation tones, mirrored locally so this service depends on no component. */
  var TONES = { INFO: 'info', SUCCESS: 'success', WARNING: 'warning', ERROR: 'error' };

  /**
   * The operational domains a report section can be generated from. `workspace`
   * names the Workspace Registry id the lineage chip navigates to, so a reader
   * moves from a paragraph to the source object in one click.
   */
  var DOMAINS = {
    WALKTHROUGH: 'walkthrough',
    EVIDENCE: 'evidence',
    CONTROLS: 'controls',
    TESTING: 'testing',
    FINDINGS: 'findings',
    ENTITY: 'entity'
  };

  /** Human-readable labels for the lineage domains (Issue #41 — Generated From). */
  var DOMAIN_LABELS = {
    walkthrough: 'Walkthrough',
    evidence: 'Evidence',
    controls: 'Controls',
    testing: 'Testing',
    findings: 'Findings',
    entity: 'Entity Information'
  };

  /**
   * The five canonical report sections, in document order. `recordId` is the
   * section record the current dataset schema declares for it (Sections I–IV);
   * Section V has no section record because the entity-supplied registers it
   * renders are top-level document keys, not authored narrative sections.
   *
   * `generated` marks the sections that regenerate continuously as operational
   * state changes; `audited` marks whether the content falls inside audit
   * scope — Section V is the one that does not, and says so everywhere.
   */
  var CANONICAL_SECTIONS = [
    {
      id: 'SEC-1', numeral: 'I', key: 'management-assertion',
      title: 'Management Assertion',
      recordId: 'SEC-1',
      generated: false, audited: true,
      domains: [],
      summary: 'Management’s written assertion about the system and the suitability of its controls. Authored by the entity and filled as part of report issuance.'
    },
    {
      id: 'SEC-2', numeral: 'II', key: 'auditor-report',
      title: 'Independent Auditor Report',
      recordId: 'SEC-2',
      generated: false, audited: true,
      domains: [],
      summary: 'The independent service auditor’s assurance report and opinion. Authored by the engagement partner and filled as part of report issuance.'
    },
    {
      id: 'SEC-3', numeral: 'III', key: 'system-description',
      title: 'System Description',
      recordId: 'SEC-3',
      generated: true, audited: true,
      domains: [DOMAINS.WALKTHROUGH, DOMAINS.EVIDENCE, DOMAINS.CONTROLS, DOMAINS.TESTING, DOMAINS.FINDINGS],
      summary: 'The description of the system, generated continuously from walkthrough understanding, approved evidence, the controls in scope, testing performed, and approved findings.'
    },
    {
      id: 'SEC-4', numeral: 'IV', key: 'testing-results',
      title: 'Testing Results',
      recordId: 'SEC-4',
      generated: true, audited: true,
      domains: [DOMAINS.CONTROLS, DOMAINS.EVIDENCE, DOMAINS.TESTING, DOMAINS.FINDINGS],
      summary: 'The trust services criteria, controls, tests, and results, generated directly from the Testing workspace: control, procedure, evidence, result, conclusion, and linked findings.'
    },
    {
      id: 'SEC-5', numeral: 'V', key: 'entity-information',
      title: 'Entity Information (Not Audited)',
      recordId: null,
      generated: true, audited: false,
      domains: [DOMAINS.ENTITY],
      summary: 'Information supplied by the entity that falls outside the scope of the audit. Presented as provided and not covered by the auditor’s opinion.'
    }
  ];

  /**
   * The notice every continuously generated section displays (Issue #41 —
   * Continuous AI Drafting). Stated verbatim so the promise the user reads is
   * the promise the platform keeps.
   */
  var GENERATION_NOTICE = 'Generated using currently approved walkthroughs, evidence, testing, findings and entity information. This section will continue evolving until report issuance.';

  /** The notice Section V displays, so "not audited" is never implicit. */
  var NOT_AUDITED_NOTICE = 'Supplied by the entity and outside the scope of the audit. This information was not tested and is not covered by the auditor’s opinion.';

  /**
   * Report / section status vocabulary → tone (read, never invented). Covers
   * the statuses the datasets record today plus the version vocabulary the
   * Report Version Service advances through, so both read one tone map.
   */
  var STATUS_TONES = {
    'Draft': TONES.WARNING,
    'AI Draft': TONES.INFO,
    'In Review': TONES.WARNING,
    'Needs Review': TONES.WARNING,
    'Reviewer Approved': TONES.INFO,
    'Partner Approved': TONES.SUCCESS,
    'Approved': TONES.SUCCESS,
    'Issued': TONES.SUCCESS,
    'Final': TONES.SUCCESS
  };

  /** Section source vocabulary → display label (read, never invented). */
  var SOURCE_LABELS = {
    manual: 'Manual',
    structured: 'Structured',
    generated: 'Generated',
    template: 'Template',
    entity: 'Entity supplied'
  };

  /** Returns the value when it is an array, otherwise an empty array. */
  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  /** Resolves a status to a presentation tone (neutral when unmapped). */
  function resolveStatusTone(status) {
    return Object.prototype.hasOwnProperty.call(STATUS_TONES, status) ? STATUS_TONES[status] : null;
  }

  /** The display label of a section source (the raw value when unmapped). */
  function sourceLabel(source) {
    return Object.prototype.hasOwnProperty.call(SOURCE_LABELS, source) ? SOURCE_LABELS[source] : (source || '');
  }

  /** Finds a record by id within a list. */
  function findById(records, id) {
    var list = asArray(records);
    for (var index = 0; index < list.length; index += 1) {
      if (list[index] && list[index].id === id) {
        return list[index];
      }
    }
    return null;
  }

  // ------------------------------------------------------------------
  // Generated content — every block below reads recorded state. A domain that
  // records nothing yields no block, so an empty engagement renders an honest
  // empty section rather than invented narrative.
  // ------------------------------------------------------------------

  /**
   * The System Description blocks (Section III): one factual block per
   * operational domain that actually holds data for the engagement, each
   * stating a real, current measurement of the engagement's own records.
   *
   * Release 2 extension point: `draftNarrative` replaces these factual blocks
   * with AI-authored prose over the same inputs. The block shape, the lineage,
   * and the approval path do not change.
   */
  function buildSystemDescriptionBlocks(operational) {
    var ops = operational || {};
    var blocks = [];

    var walkthroughSessions = ops.walkthroughSessions || 0;
    blocks.push({
      kind: 'fact', domain: DOMAINS.WALKTHROUGH, label: 'Walkthrough understanding',
      present: walkthroughSessions > 0,
      text: walkthroughSessions > 0
        ? walkthroughSessions + ' recorded walkthrough ' + (walkthroughSessions === 1 ? 'session' : 'sessions') + ' inform this description.'
        : 'No walkthrough sessions are recorded for this engagement yet.'
    });

    var evidenceItems = ops.evidenceItems || 0;
    var evidenceApproved = ops.evidenceApproved || 0;
    blocks.push({
      kind: 'fact', domain: DOMAINS.EVIDENCE, label: 'Evidence basis',
      present: evidenceItems > 0,
      text: evidenceItems > 0
        ? evidenceApproved + ' of ' + evidenceItems + ' evidence items are approved and available to this description.'
        : 'No evidence is recorded for this engagement yet.'
    });

    var controls = ops.controls || 0;
    blocks.push({
      kind: 'fact', domain: DOMAINS.CONTROLS, label: 'Controls in scope',
      present: controls > 0,
      text: controls > 0
        ? controls + ' ' + (controls === 1 ? 'control is' : 'controls are') + ' in scope for the engagement.'
        : 'No controls are in scope for this engagement yet.'
    });

    var tests = ops.tests || 0;
    var testsCompleted = ops.testsCompleted || 0;
    blocks.push({
      kind: 'fact', domain: DOMAINS.TESTING, label: 'Testing performed',
      present: tests > 0,
      text: tests > 0
        ? testsCompleted + ' of ' + tests + ' test workpapers are complete.'
        : 'No testing is recorded for this engagement yet.'
    });

    var approvedFindings = ops.approvedFindings || 0;
    blocks.push({
      kind: 'fact', domain: DOMAINS.FINDINGS, label: 'Approved findings',
      present: approvedFindings > 0,
      text: approvedFindings > 0
        ? approvedFindings + ' approved ' + (approvedFindings === 1 ? 'observation feeds' : 'observations feed') + ' this description.'
        : 'No approved observations feed this description yet.'
    });

    return blocks;
  }

  /**
   * One Section IV result row for a test workpaper: control, procedure,
   * evidence, result, conclusion, and linked findings (Issue #41 — Section IV).
   * Every field is read from the workpaper record; an absent field stays empty
   * rather than being filled with an assumed outcome.
   */
  function buildTestingResultRow(test, context) {
    var source = test || {};
    var ctx = context || {};
    var control = source.controlId && ctx.controlsById ? ctx.controlsById[source.controlId] : null;
    var finding = source.findingId && ctx.findingsById ? ctx.findingsById[source.findingId] : null;
    var walkthroughTest = source.walkthroughTest || {};
    var oeTest = source.oeTest || {};

    return {
      id: source.id || '',
      controlId: source.controlId || '',
      controlCode: control && control.controlCode ? control.controlCode : (source.controlId || ''),
      controlTitle: control && control.title ? control.title : '',
      procedure: source.testProcedure || source.procedure ||
        walkthroughTest.procedure || oeTest.procedure || '',
      evidence: asArray(source.evidenceIds).join(', ') || source.workingPaperId || '',
      result: source.result || source.testingStatus || '',
      conclusion: source.conclusion || '',
      findingId: source.findingId || '',
      findingTitle: finding && finding.title ? finding.title : '',
      status: source.testingStatus || source.status || '',
      statusTone: resolveTestTone(source)
    };
  }

  /**
   * The tone of one testing result: an exception (a linked finding, or a
   * recorded result reading as an exception) is a warning; a completed test
   * with no exception is a success; anything else stays neutral.
   *
   * A recorded result routinely states the *absence* of an exception ("No
   * exceptions noted", "No deviations identified"), so the negation is matched
   * before the exception is — reading that sentence as an exception would
   * invert the conclusion the workpaper actually reached.
   */
  function resolveTestTone(test) {
    var source = test || {};
    var result = String(source.result || '');
    var negated = /\b(no|without|zero)\s+(exceptions?|deviations?|failures?|findings?)\b/i.test(result);
    if (source.findingId || (!negated && /exception|fail|deviat/i.test(result))) {
      return TONES.WARNING;
    }
    if (negated || /complete|pass|effective/i.test(String(source.testingStatus || '') + ' ' + result)) {
      return TONES.SUCCESS;
    }
    return null;
  }

  /**
   * The Section IV result rows for the engagement, in workpaper order — every
   * workpaper the engagement records, never capped. The report and its native
   * exports read this same list, so the screen and the document can never
   * disagree about how many results the audit produced.
   */
  function buildTestingResults(tests, context) {
    return asArray(tests).map(function (test) {
      return buildTestingResultRow(test, context);
    });
  }

  /**
   * The Section V entity-information registers: the entity-supplied content the
   * report document records — Complementary User Entity Controls,
   * Complementary Subservice Organization Controls, and the IPE procedures.
   * Each register is emitted only when the document actually carries it, and
   * each is labelled as not audited.
   */
  function buildEntityInformation(reportDocument) {
    var document = reportDocument || {};
    var registers = [];

    var cuecs = asArray(document.cuecs);
    if (cuecs.length > 0) {
      registers.push({
        key: 'cuecs',
        label: 'Complementary User Entity Controls',
        description: 'Controls the entity states its user entities are expected to operate. Supplied by the entity; not tested by the auditor.',
        rows: cuecs.map(function (entry, index) {
          return {
            id: entry.id || ('CUEC-' + (index + 1)),
            text: entry.text || '',
            criteria: asArray(entry.criteria).join(', '),
            controls: asArray(entry.controlCodes).join(', ')
          };
        })
      });
    }

    var csocs = asArray(document.csocs);
    if (csocs.length > 0) {
      registers.push({
        key: 'csocs',
        label: 'Complementary Subservice Organization Controls',
        description: 'Controls the entity states its subservice organizations are expected to operate. Supplied by the entity; not tested by the auditor.',
        rows: csocs.map(function (entry, index) {
          return {
            id: entry.id || ('CSOC-' + (index + 1)),
            text: entry.text || '',
            criteria: asArray(entry.criteria).join(', '),
            controls: asArray(entry.controlCodes).join(', ')
          };
        })
      });
    }

    var ipe = asArray(document.ipeProcedures);
    if (ipe.length > 0) {
      registers.push({
        key: 'ipe',
        label: 'Information Provided by the Entity',
        description: 'The procedures the entity states it follows over information it provides. Supplied by the entity; presented as provided.',
        rows: ipe.map(function (entry, index) {
          return {
            id: 'IPE-' + (index + 1),
            text: typeof entry === 'string' ? entry : (entry && entry.text ? entry.text : ''),
            criteria: '',
            controls: ''
          };
        })
      });
    }

    return registers;
  }

  /**
   * The section's narrative prose: the drafted paragraph a human has approved,
   * or null when there is none.
   *
   * This function does not call a model. Drafting is asynchronous and every
   * draft is a proposal, so it belongs to `AuditOS.narrativeAgent`, which
   * authors prose from `blocks` (the recorded facts the section is generated
   * from) and files it as a Suggestion carrying the concrete write to perform
   * on Apply. Approving that suggestion is what puts `narrative` on the section
   * record; this function reads it back. Nothing here writes, so human approval
   * remains mandatory and an unapproved draft appears nowhere in the report or
   * its exports.
   *
   * Returning null keeps the pre-AI behaviour exactly intact: a narrative
   * section with no approved content renders its honest placeholder rather than
   * invented prose, whether that is because nothing was drafted, nothing was
   * approved, or no AI backend is running at all.
   */
  function draftNarrative(sectionKey, blocks, context, record) {
    var source = record || {};
    if (typeof source.narrative !== 'string') {
      return null;
    }
    var text = source.narrative.trim();
    return text ? text : null;
  }

  // ------------------------------------------------------------------
  // Section assembly
  // ------------------------------------------------------------------

  /**
   * The lineage of one section: the operational domains it is generated from,
   * each with its real current count and the workspace it navigates to. A
   * domain with no data is kept and marked absent — "no evidence yet" is a
   * fact the reader needs, and hiding it would misrepresent the basis.
   */
  function buildLineage(domains, operational) {
    var ops = operational || {};
    var counts = {};
    counts[DOMAINS.WALKTHROUGH] = ops.walkthroughSessions || 0;
    counts[DOMAINS.EVIDENCE] = ops.evidenceItems || 0;
    counts[DOMAINS.CONTROLS] = ops.controls || 0;
    counts[DOMAINS.TESTING] = ops.tests || 0;
    counts[DOMAINS.FINDINGS] = ops.approvedFindings || 0;
    counts[DOMAINS.ENTITY] = ops.entityItems || 0;

    return asArray(domains).map(function (domain) {
      var count = counts[domain] || 0;
      return {
        domain: domain,
        label: DOMAIN_LABELS[domain] || domain,
        workspaceId: domain === DOMAINS.ENTITY ? null : domain,
        count: count,
        present: count > 0
      };
    });
  }

  /**
   * Assembles one canonical section against the report document and the
   * engagement's operational state. Sections I–IV bind to their recorded
   * section record; Section V binds to the entity registers. The `status` is
   * the recorded one where the dataset declares it, else the section's
   * generation state — never an invented approval.
   */
  function buildSection(definition, reportDocument, operational, context) {
    var document = reportDocument || {};
    var record = definition.recordId ? findById(document.sections, definition.recordId) : null;
    var ops = operational || {};

    var section = {
      id: definition.id,
      key: definition.key,
      numeral: definition.numeral,
      title: record && record.name ? record.name : definition.title,
      canonicalTitle: definition.title,
      summary: definition.summary,
      generated: definition.generated,
      audited: definition.audited,
      recorded: Boolean(record) || definition.id === 'SEC-5',
      source: record && record.source ? record.source : (definition.generated ? 'generated' : 'manual'),
      editable: record ? record.editable !== false : definition.generated === false,
      included: record ? record.included !== false : true,
      status: record && record.status ? record.status : '',
      generationNotice: definition.generated ? GENERATION_NOTICE : '',
      notAuditedNotice: definition.audited ? '' : NOT_AUDITED_NOTICE,
      lineage: buildLineage(definition.domains, ops),
      blocks: [],
      rows: [],
      registers: [],
      narrative: null
    };
    section.sourceLabel = sourceLabel(section.source);
    section.statusTone = resolveStatusTone(section.status);

    switch (definition.key) {
      case 'system-description':
        section.blocks = buildSystemDescriptionBlocks(ops);
        section.narrative = draftNarrative(definition.key, section.blocks, context, record);
        section.present = section.blocks.some(function (block) { return block.present; });
        break;
      case 'testing-results':
        section.rows = buildTestingResults(ops.testRecords, context);
        section.present = section.rows.length > 0;
        break;
      case 'entity-information':
        section.registers = buildEntityInformation(document);
        section.present = section.registers.length > 0;
        break;
      default:
        // Sections I and II are authored at issuance; they are "present" when
        // the dataset declares the section at all, and their recorded status
        // says plainly that the content is still a placeholder.
        section.present = Boolean(record);
        break;
    }

    section.itemCount = section.rows.length ||
      section.registers.reduce(function (sum, register) { return sum + register.rows.length; }, 0) ||
      section.blocks.filter(function (block) { return block.present; }).length;

    return section;
  }

  /**
   * The complete report model: document identity, the five canonical sections,
   * and the aggregate completion the header reads. Returns a model even when the
   * engagement records no report document, so the workspace renders an honest
   * "the report has not been started" state rather than nothing at all.
   */
  function buildReport(reportDocument, operational, context) {
    var document = reportDocument || {};
    var identity = document.document || {};
    var ops = operational || {};

    var entityItems = asArray(document.cuecs).length + asArray(document.csocs).length +
      asArray(document.ipeProcedures).length;
    var enriched = {};
    Object.keys(ops).forEach(function (key) { enriched[key] = ops[key]; });
    enriched.entityItems = entityItems;

    var sections = CANONICAL_SECTIONS.map(function (definition) {
      return buildSection(definition, document, enriched, context);
    });

    var generatedSections = sections.filter(function (section) { return section.generated; });
    var generatedPresent = generatedSections.filter(function (section) { return section.present; });

    return {
      exists: Boolean(document.document) || asArray(document.sections).length > 0,
      reportId: (document.metadata && document.metadata.reportId) || '',
      templateId: (document.metadata && document.metadata.templateId) || '',
      title: identity.title || '',
      status: identity.status || '',
      statusTone: resolveStatusTone(identity.status),
      version: identity.version || '',
      reportingPeriod: identity.reportingPeriod || null,
      renderEngine: (document.generation && document.generation.renderEngine) || '',
      futureAutomation: (document.generation && document.generation.futureAutomation) || null,
      criteriaTables: asArray(document.criteriaTables),
      sections: sections,
      completion: {
        generated: generatedPresent.length,
        generatedTotal: generatedSections.length,
        sections: sections.filter(function (section) { return section.present; }).length,
        total: sections.length
      }
    };
  }

  /**
   * The sections one changed operational domain regenerates (Issue #41 — "only
   * affected sections regenerate. No full regeneration"). A domain that feeds no
   * section regenerates nothing; a section is named once even when several of
   * its domains changed.
   */
  function sectionsAffectedBy(domains) {
    var changed = asArray(domains);
    return CANONICAL_SECTIONS.filter(function (definition) {
      return definition.generated && definition.domains.some(function (domain) {
        return changed.indexOf(domain) !== -1;
      });
    }).map(function (definition) {
      return { id: definition.id, numeral: definition.numeral, title: definition.title, key: definition.key };
    });
  }

  /**
   * The regeneration plan for a set of changed domains: which sections
   * regenerate, which stay untouched, and the reason each one is in its bucket.
   * The Reporting workspace renders this so the user can see that a walkthrough
   * change regenerated Section III alone and left the rest of the report intact.
   */
  function planRegeneration(domains) {
    var changed = asArray(domains);
    var affected = sectionsAffectedBy(changed);
    var affectedIds = affected.map(function (section) { return section.id; });
    return {
      changedDomains: changed.map(function (domain) {
        return { domain: domain, label: DOMAIN_LABELS[domain] || domain };
      }),
      regenerate: affected,
      unchanged: CANONICAL_SECTIONS.filter(function (definition) {
        return affectedIds.indexOf(definition.id) === -1;
      }).map(function (definition) {
        return { id: definition.id, numeral: definition.numeral, title: definition.title, key: definition.key };
      })
    };
  }

  AuditOS.reportGenerationService = {
    TONES: TONES,
    DOMAINS: DOMAINS,
    DOMAIN_LABELS: DOMAIN_LABELS,
    CANONICAL_SECTIONS: CANONICAL_SECTIONS,
    GENERATION_NOTICE: GENERATION_NOTICE,
    NOT_AUDITED_NOTICE: NOT_AUDITED_NOTICE,
    STATUS_TONES: STATUS_TONES,

    resolveStatusTone: resolveStatusTone,
    sourceLabel: sourceLabel,
    buildSystemDescriptionBlocks: buildSystemDescriptionBlocks,
    buildTestingResultRow: buildTestingResultRow,
    buildTestingResults: buildTestingResults,
    buildEntityInformation: buildEntityInformation,
    buildLineage: buildLineage,
    buildSection: buildSection,
    buildReport: buildReport,
    sectionsAffectedBy: sectionsAffectedBy,
    planRegeneration: planRegeneration,

    /**
     * Release 2 extension point — see `draftNarrative`. Exposed so a Release 2
     * AI module replaces exactly one function and nothing else in this service.
     */
    draftNarrative: draftNarrative
  };
})(window);
