/**
 * AuditOS Reporting Workspace
 * Living Reporting & Operational Findings — GitHub Issue #41 / Workspace
 * Architecture — Chapter 61 / Component Architecture — Chapter 74
 *
 * The operational workspace of the engagement's living report. The report is
 * not produced at the end of the audit: it exists from engagement creation and
 * evolves continuously as walkthroughs, evidence, controls, testing, and
 * approved findings change. This workspace is where that document is read,
 * traced back to its sources, edited through approval, versioned, and exported.
 *
 * Layout (Issue #41 — Reporting Workspace): one full-height three-column
 * Workbench, composed from the shared `AuditOS.presentation.workbench` the
 * Controls and Testing workspaces already use — never a second layout.
 *
 *   Left    Report Navigator   — the five sections, their source and status
 *   Middle  Selected Report    — the section in full, with its generation
 *                                notice, content, and AI lineage
 *   Right   AI Suggestions · History · Approvals · Lineage
 *
 * Everything business-shaped is delegated, never re-derived here:
 *  - `AuditOS.reportGenerationService` assembles the five-section report model
 *    and decides which sections a change regenerates.
 *  - `AuditOS.reportVersionService` owns Draft → AI Draft → Reviewer Approved →
 *    Partner Approved → Issued, and the immutability of an issued report.
 *  - `AuditOS.reportPropagationService` owns Edit → impact → Suggestion →
 *    Approval → Propagation, which runs on the canonical Suggestion Lifecycle
 *    Service and the Synchronization Bus. There are no direct writes to the
 *    report from this workspace.
 *  - `AuditOS.documentExport` serializes the same report model to DOCX, PDF,
 *    and HTML, so the screen and the exported document can never disagree.
 *
 * Architecture: Business → ViewModel → Components → DOM, identical to every
 * other operational workspace. `collectViewModel` is the single place this
 * workspace reads `AuditOS.state`; it returns a declarative model of pure,
 * offline-testable derivations. The renderer configures the Shared Workspace
 * Framework's inherited skeleton and fills its slots with compositions from the
 * Enterprise Data Presentation System — no bespoke primitives, no duplicated
 * components (Component Design Patterns §81.4 — Composition Over Duplication).
 *
 * Release 1 renders only what the engagement records. A section with no
 * recorded content says so; a lineage domain with no data reads "none
 * recorded"; nothing is fabricated and no conclusion is inferred. The Release 2
 * seams are marked in the services, not duplicated here: AI narrative drafting
 * (`reportGenerationService.draftNarrative`), AI impact reasoning
 * (`reportPropagationService.describeImpact`), and the AI-generated Improvement
 * Register, whose Release 1 placeholder generation entry is rendered below.
 *
 * Loaded as a classic script so the prototype runs directly from
 * file:///.../prototype/index.html with no build step or module loader.
 */
(function (global) {
  'use strict';

  var AuditOS = global.AuditOS = global.AuditOS || {};

  /** Shared Workspace Platform (Issue #27) — harmonized helpers reused across every operational workspace. */
  var WS = AuditOS.workspaceShared || {};

  // ------------------------------------------------------------------
  // Constants
  // ------------------------------------------------------------------

  /** The Shared Workspace Framework slots this workspace fills directly. */
  var SLOTS = {
    CONTENT: 'primary-content',
    RELATED: 'related-information',
    AI: 'ai-recommendations',
    ACTIVITY: 'activity',
    FOOTER: 'workspace-footer'
  };

  /** Presentation tones shared by badges, markers, and rails. */
  var TONES = WS.TONES;

  /** Maximum entries per supporting list so panels stay scannable. */
  var LIST_LIMIT = WS.LIST_LIMIT;

  /** The header action identifiers the renderer wires after the framework builds them. */
  var ACTIONS = {
    DOCX: 'report-export-docx',
    PDF: 'report-export-pdf',
    HTML: 'report-export-html'
  };

  /** Returns the value when it is an array, otherwise an empty array. */
  var asArray = WS.asArray;

  /** Formats an ISO `YYYY-MM-DD` date as a compact, deterministic label. */
  var formatDate = WS.formatDate;

  /** Formats a `{ startDate, endDate }` period as `start – end`. */
  var formatPeriod = WS.formatPeriod;

  /** The frameworks attached to an engagement, always as an array. */
  var normalizeFrameworks = WS.normalizeFrameworks;

  /** Reads the first dataset document an engagement owns in a collection, or null. */
  var readEngagementDocument = WS.readEngagementDocument;

  /** Finds a record by id within a list. */
  var findById = WS.findById;

  /** Indexes a list of records by their id field. */
  var indexById = WS.indexById;

  // ------------------------------------------------------------------
  // Services, resolved at call time so load order stays flexible.
  // ------------------------------------------------------------------

  function generation() { return AuditOS.reportGenerationService || null; }
  function versions() { return AuditOS.reportVersionService || null; }
  function propagation() { return AuditOS.reportPropagationService || null; }
  function exporter() { return AuditOS.documentExport || null; }
  function suggestionService() { return AuditOS.suggestionService || null; }

  // ------------------------------------------------------------------
  // Pure derivation helpers — no DOM, no AuditOS.state access.
  // ------------------------------------------------------------------

  /**
   * The operational state the report is generated from: one real, current count
   * per domain, plus the test records Section IV renders. Every figure is a
   * measurement of the engagement's own records; an absent domain reads zero
   * rather than a fabricated number.
   */
  function deriveOperational(documents) {
    var source = documents || {};
    var evidenceSummary = (source.evidence && source.evidence.summary) || {};
    var testRecords = asArray(source.testing && source.testing.tests);
    var findingRecords = asArray(source.findings && source.findings.findings);

    return {
      walkthroughSessions: asArray(source.walkthroughs && source.walkthroughs.sessions).length,
      evidenceItems: evidenceSummary.evidenceItems || 0,
      evidenceApproved: evidenceSummary.approved || 0,
      controls: asArray(source.controls && source.controls.controls).length,
      tests: testRecords.length,
      testsCompleted: testRecords.filter(function (test) {
        return /complete/i.test(String(test.testingStatus || test.status || ''));
      }).length,
      findings: findingRecords.length,
      approvedFindings: findingRecords.filter(isApprovedObservation).length,
      testRecords: testRecords
    };
  }

  /**
   * Whether an observation is approved for the report — the states past
   * management response in the Observation lifecycle the Findings workspace
   * owns (Issue #41), plus the `reportable` flag the current datasets carry.
   * Read, never inferred: an observation in no such state is not counted.
   */
  function isApprovedObservation(finding) {
    var source = finding || {};
    var status = String(source.status || '');
    return Boolean(source.reportable) ||
      status === 'Accepted' || status === 'Resolved' || status === 'Closed';
  }

  /**
   * The Report Health strip — one indicator per canonical section (its own
   * generation state) plus the report's current version and the count of report
   * edits awaiting a decision. Real values only.
   */
  function deriveReportHealth(report, version, pendingApprovals) {
    var indicators = asArray(report && report.sections).map(function (section) {
      var status = !section.recorded ? 'Not recorded'
        : section.present ? (section.generated ? 'Generated' : 'Recorded')
          : 'Awaiting content';
      var tone = !section.recorded ? null
        : section.present ? (section.audited ? TONES.SUCCESS : TONES.INFO)
          : TONES.WARNING;
      return { key: 'section-' + section.id, label: 'Section ' + section.numeral, status: status, tone: tone };
    });

    indicators.push({
      key: 'version',
      label: 'Version',
      status: version ? (version.version ? version.version + ' · ' + version.status : version.status) : 'Not started',
      tone: version ? (version.immutable ? TONES.SUCCESS : TONES.INFO) : null
    });

    indicators.push({
      key: 'approvals',
      label: 'Report approvals',
      status: pendingApprovals > 0 ? String(pendingApprovals) + ' pending' : 'Clear',
      tone: pendingApprovals > 0 ? TONES.WARNING : TONES.SUCCESS
    });

    return indicators;
  }

  /**
   * The Audit Lineage — Walkthrough → Evidence → Controls → Testing → Findings
   * → Report, with Report highlighted as the object this workspace owns. Each
   * node carries its real, current count and a link into its workspace; nodes
   * with no data read "—" and never a fabricated figure.
   */
  function deriveLineage(workspaceRegistry, operational, report) {
    if (!workspaceRegistry) {
      return [];
    }
    var ops = operational || {};
    var ids = workspaceRegistry.IDS;
    var nodes = [
      { id: ids.WALKTHROUGH, label: 'Walkthrough', count: ops.walkthroughSessions || 0, present: (ops.walkthroughSessions || 0) > 0, hint: 'Knowledge acquisition' },
      { id: ids.EVIDENCE, label: 'Evidence', count: ops.evidenceItems || 0, present: (ops.evidenceItems || 0) > 0, hint: 'What the description rests on' },
      { id: ids.CONTROLS, label: 'Controls', count: ops.controls || 0, present: (ops.controls || 0) > 0, hint: 'What testing validates' },
      { id: ids.TESTING, label: 'Testing', count: ops.tests || 0, present: (ops.tests || 0) > 0, hint: 'Section IV results' },
      { id: ids.FINDINGS, label: 'Findings', count: ops.approvedFindings || 0, present: (ops.approvedFindings || 0) > 0, hint: 'Approved observations' },
      {
        id: ids.REPORTING, label: 'Report',
        count: report ? report.completion.sections : 0,
        present: Boolean(report && report.exists),
        hint: report && report.status ? report.status : 'Not started',
        highlighted: true
      }
    ];
    return WS.resolveLineageNodes(workspaceRegistry, nodes);
  }

  /**
   * The Report Navigator rows: one per canonical section, in document order.
   * Never re-sorted — the order is the report's table of contents.
   */
  function deriveNavigator(report) {
    return asArray(report && report.sections).map(function (section) {
      return {
        id: section.id,
        section: section,
        numeral: section.numeral,
        title: section.title,
        sourceLabel: section.sourceLabel,
        status: section.status,
        statusTone: section.statusTone,
        audited: section.audited,
        generated: section.generated,
        present: section.present,
        itemCount: section.itemCount
      };
    });
  }

  /**
   * The regeneration plan the workspace shows for the report as a whole: for
   * each operational domain that currently holds data, which sections a change
   * to it regenerates. This is the visible proof of "only affected sections
   * regenerate — no full regeneration".
   */
  function deriveRegenerationPlan(operational) {
    var service = generation();
    if (!service) {
      return [];
    }
    var ops = operational || {};
    var counts = {};
    counts[service.DOMAINS.WALKTHROUGH] = ops.walkthroughSessions || 0;
    counts[service.DOMAINS.EVIDENCE] = ops.evidenceItems || 0;
    counts[service.DOMAINS.CONTROLS] = ops.controls || 0;
    counts[service.DOMAINS.TESTING] = ops.tests || 0;
    counts[service.DOMAINS.FINDINGS] = ops.approvedFindings || 0;

    return Object.keys(counts).map(function (domain) {
      var affected = service.sectionsAffectedBy([domain]);
      return {
        domain: domain,
        label: service.DOMAIN_LABELS[domain] || domain,
        count: counts[domain],
        sections: affected.map(function (section) { return 'Section ' + section.numeral; }).join(', ') || 'None'
      };
    });
  }

  /**
   * Related audit objects for the supporting panel: the domains the report is
   * generated from, each with its real count, only when data exists.
   */
  function deriveRelationships(workspaceRegistry, operational) {
    if (!workspaceRegistry) {
      return [];
    }
    var ops = operational || {};
    var ids = workspaceRegistry.IDS;
    return WS.resolveRelationships(workspaceRegistry, [
      { id: ids.TESTING, title: 'Testing', meta: String(ops.tests || 0), present: (ops.tests || 0) > 0 },
      { id: ids.CONTROLS, title: 'Controls', meta: String(ops.controls || 0), present: (ops.controls || 0) > 0 },
      { id: ids.EVIDENCE, title: 'Evidence', meta: String(ops.evidenceItems || 0), present: (ops.evidenceItems || 0) > 0 },
      { id: ids.FINDINGS, title: 'Findings', meta: String(ops.findings || 0), present: (ops.findings || 0) > 0 }
    ]);
  }

  /**
   * Report document metadata: created / modified / owner / version / source,
   * derived from the report document's own metadata and the engagement.
   */
  function deriveMetadata(reportMetadata, engagement, company, report) {
    var meta = reportMetadata || {};
    return {
      created: company && company.createdAt ? formatDate(company.createdAt) : '',
      modified: meta.generatedAt ? formatDate(String(meta.generatedAt).slice(0, 10)) : '',
      owner: engagement ? (engagement.engagementLead || engagement.auditor || '') : '',
      version: (report && report.version) || meta.version || '',
      template: (report && report.templateId) || '',
      renderEngine: (report && report.renderEngine) || '',
      source: meta.source || ''
    };
  }

  // ------------------------------------------------------------------
  // View model — the single place this workspace reads AuditOS.state.
  // ------------------------------------------------------------------

  /**
   * Collects everything the Reporting Workspace presents from the Shared Audit
   * State. Returns null while the state is not ready, and a degraded model when
   * no engagement exists (§15.12).
   */
  function collectViewModel(state, workspaceRegistry, routeContext) {
    if (!state || !state.isReady()) {
      return null;
    }

    var status = state.getStatus();
    var engagements = state.listRecords('engagements');
    var engagement = WS.resolveContextEngagement(engagements, routeContext);
    if (!engagement) {
      return { degraded: true, status: status };
    }

    var company = findById(state.listRecords('companies'), engagement.companyId);
    var documents = {
      report: readEngagementDocument(state, 'reports', engagement.id) || {},
      controls: readEngagementDocument(state, 'controls', engagement.id) || {},
      evidence: readEngagementDocument(state, 'evidence', engagement.id) || {},
      testing: readEngagementDocument(state, 'testing', engagement.id) || {},
      findings: readEngagementDocument(state, 'findings', engagement.id) || {},
      walkthroughs: readEngagementDocument(state, 'walkthroughs', engagement.id) || {}
    };

    // Single source of truth for the report's lifecycle position (Issue #42
    // documentation-validation fix): overwrites `documents.report.document`'s
    // recorded `status`/`version` with the report-version register's current
    // answer before anything else reads it, so `buildReport` below, this
    // workspace's header badge, and `documentExport`'s cover-page metadata —
    // which all ultimately read the same report model — can never disagree.
    WS.resolveReportStatus(engagement.id, documents.report);

    var operational = deriveOperational(documents);
    var context = {
      controlsById: indexById(documents.controls.controls),
      findingsById: indexById(documents.findings.findings),
      workspaceRegistry: workspaceRegistry,
      engagement: engagement,
      company: company
    };

    var service = generation();
    var report = service
      ? service.buildReport(documents.report, operational, context)
      : { exists: false, sections: [], completion: { generated: 0, generatedTotal: 0, sections: 0, total: 0 } };

    var repository = AuditOS.repository;
    var versionService = versions();
    var versionList = versionService && repository
      ? versionService.listVersions(repository, engagement.id, documents.report) : [];
    var currentVersion = versionList.length > 0 ? versionList[versionList.length - 1] : null;
    var editability = versionService && repository
      ? versionService.editability(repository, engagement.id, documents.report)
      : { editable: true, reason: '', version: null };

    var propagationService = propagation();
    var pendingApprovals = propagationService && repository
      ? propagationService.listPendingApprovals(repository, engagement.id) : [];
    var editSuggestions = propagationService && repository
      ? propagationService.listEditSuggestions(repository, engagement.id, null) : [];

    var frameworks = normalizeFrameworks(engagement);
    var auditPeriodLabel = formatPeriod(engagement.auditPeriod);

    return {
      degraded: false,
      status: status,
      engagement: engagement,
      company: company,
      frameworks: frameworks,
      context: context,
      reportDocument: documents.report,
      operational: operational,
      report: report,
      navigator: deriveNavigator(report),
      versions: versionList,
      currentVersion: currentVersion,
      editability: editability,
      pendingApprovals: pendingApprovals,
      editSuggestions: editSuggestions,
      regeneration: deriveRegenerationPlan(operational),
      reportHealth: deriveReportHealth(report, currentVersion, pendingApprovals.length),
      lineage: deriveLineage(workspaceRegistry, operational, report),
      relationships: deriveRelationships(workspaceRegistry, operational),
      metadata: deriveMetadata(documents.report.metadata, engagement, company, report),

      header: {
        eyebrow: engagement.engagementCode + ' · Reporting',
        title: company ? company.name : engagement.companyId,
        meta: (report.title || engagement.name) + ' · continuously generated',
        frameworks: frameworks,
        status: report.status ? { label: report.status, tone: report.statusTone } : { label: 'Not started', tone: null },
        lastUpdated: documents.report.metadata && documents.report.metadata.generatedAt
          ? 'Updated ' + formatDate(String(documents.report.metadata.generatedAt).slice(0, 10))
          : '',
        actions: [
          { label: 'Export DOCX', id: ACTIONS.DOCX, variant: 'primary' },
          { label: 'Export PDF', id: ACTIONS.PDF, variant: 'subtle' },
          { label: 'Export HTML', id: ACTIONS.HTML, variant: 'subtle' }
        ]
      },

      ribbon: [
        { label: 'Client', value: company ? company.name : engagement.companyId },
        { label: 'Audit period', value: auditPeriodLabel },
        { label: 'Sections', value: report.completion.sections + ' of ' + report.completion.total },
        { label: 'Version', value: currentVersion ? currentVersion.version || currentVersion.status : '—' }
      ],

      footer: [
        { label: 'Environment', value: 'Static prototype' },
        { label: 'Demo status', value: status.demoDataLoaded ? 'Demo data loaded' : 'Demo data degraded' }
      ]
    };
  }

  // ------------------------------------------------------------------
  // Generic DOM builders — thin layout wrappers around the Enterprise Data
  // Presentation System. Text is always assigned through textContent, never
  // markup injection.
  // ------------------------------------------------------------------

  /** Creates an element with a class and optional text content. */
  var el = WS.el;

  /** The shared presentation system, resolved at render time. */
  var presentation = WS.presentation;

  /** Builds the Report Health strip (identical composition to every operational workspace). */
  function buildHealthStrip(items) {
    return WS.buildHealthStrip('aos-reporting', 'Report health', items);
  }

  /** Builds the Audit Lineage body: the methodology chain with Report highlighted. */
  function buildLineageBody(lineage) {
    return WS.buildLineageBody('aos-reporting', lineage);
  }

  /** Builds a run of labeled value items for the workspace footer. */
  function buildFooterItems(entries) {
    return WS.buildFooterItems('aos-reporting', entries);
  }

  /** Builds one titled pane block: a fixed structural heading above its body. */
  function paneBlock(title, body) {
    var block = el('section', 'aos-reporting__block');
    block.appendChild(el('h3', 'aos-reporting__block-title', title));
    block.appendChild(body);
    return block;
  }

  /**
   * Memory-only presentation state: which section is selected and the text
   * currently typed into the change proposal. Never business data; discarded on
   * reload, and never written back to the Repository.
   */
  var boardState = { sectionId: '', draft: '', lastTargetId: '' };

  /** Builds one Report Navigator row: numeral + title, source, status, and item count. */
  function buildRow(row) {
    var P = presentation();
    var node = el('button', null);
    node.type = 'button';

    var head = el('div', 'aos-reporting__row-head');
    var identity = el('div', 'aos-reporting__row-identity');
    identity.appendChild(el('span', 'aos-reporting__row-numeral aos-numeric', row.numeral));
    identity.appendChild(el('span', 'aos-reporting__row-title', row.title));
    head.appendChild(identity);
    if (row.status) {
      head.appendChild(P.statusBadge({ label: row.status, tone: row.statusTone }));
    }
    node.appendChild(head);

    var meta = el('div', 'aos-reporting__row-meta');
    if (row.sourceLabel) {
      meta.appendChild(el('span', 'aos-reporting__row-source', row.sourceLabel));
    }
    if (row.generated) {
      meta.appendChild(el('span', 'aos-reporting__row-flag', 'Continuously generated'));
    }
    if (!row.audited) {
      meta.appendChild(el('span', 'aos-reporting__row-flag aos-reporting__row-flag--warning', 'Not audited'));
    }
    if (row.itemCount > 0) {
      meta.appendChild(el('span', 'aos-reporting__row-count aos-numeric', String(row.itemCount)));
    }
    node.appendChild(meta);
    return node;
  }

  /**
   * Builds the left pane: the Report Navigator. The five sections in document
   * order — never re-sorted, because the order is the table of contents.
   */
  function buildNavigatorRail(viewModel, targetId, onSelect) {
    var rail = el('div', 'aos-reporting__rail');
    rail.appendChild(el('p', 'aos-reporting__rail-count',
      viewModel.report.completion.sections + ' of ' + viewModel.report.completion.total + ' sections with content'));

    var listNode = el('div', 'aos-reporting__row-list');
    listNode.setAttribute('role', 'list');
    WS.mountRailGroups('aos-reporting', listNode, null,
      [{ label: '', rows: viewModel.navigator }], viewModel.context,
      buildRow, null, 'section', targetId, onSelect);
    rail.appendChild(listNode);
    return rail;
  }

  /**
   * Builds the AI Lineage chip row for one section (Issue #41 — AI Lineage):
   * "Generated From", each domain with its real count and a link into the
   * workspace that owns the source objects. A domain with no data is shown as
   * absent rather than hidden — the basis of a paragraph includes what is not
   * there yet.
   */
  function buildSectionLineage(section, workspaceRegistry) {
    var wrap = el('div', 'aos-reporting__lineage-chips');
    wrap.setAttribute('role', 'list');
    wrap.setAttribute('aria-label', 'Generated from');
    asArray(section.lineage).forEach(function (node) {
      var workspace = node.workspaceId && workspaceRegistry
        ? workspaceRegistry.findById(node.workspaceId) : null;
      var href = workspace ? WS.workspacePathHref(workspace.path) : null;
      var chip = el(href ? 'a' : 'span',
        'aos-reporting__lineage-chip' + (node.present ? '' : ' aos-reporting__lineage-chip--empty'));
      chip.setAttribute('role', 'listitem');
      if (href) {
        chip.setAttribute('href', href);
      }
      chip.appendChild(el('span', 'aos-reporting__lineage-chip-label', node.label));
      chip.appendChild(el('span', 'aos-reporting__lineage-chip-count aos-numeric',
        node.present ? String(node.count) : '—'));
      wrap.appendChild(chip);
    });
    return wrap;
  }

  /**
   * Builds the Section IV testing-results grid: control, procedure, evidence,
   * result, conclusion, linked findings — every workpaper the engagement
   * records. The Workbench canvas owns its own scrolling (Issue #40 §2/§12),
   * so the grid is never truncated here; the screen renders exactly the rows
   * every export writes.
   */
  function buildTestingResultsBody(section, workspaceRegistry) {
    var P = presentation();
    var ids = workspaceRegistry ? workspaceRegistry.IDS : {};
    var rows = section.rows.map(function (row) {
      var findingCell = row.findingId
        ? [row.findingId, row.findingTitle].filter(Boolean).join(' · ')
        : '';
      return {
        id: row.id,
        status: row.status ? { label: row.status, tone: row.statusTone } : null,
        cells: {
          control: [row.controlCode, row.controlTitle].filter(Boolean).join(' — '),
          procedure: row.procedure,
          evidence: row.evidence,
          result: row.result,
          conclusion: row.conclusion,
          finding: findingCell
        },
        actions: row.findingId && WS.buildRecordHref(workspaceRegistry, ids.FINDINGS, row.findingId)
          ? [{ label: 'Open finding', href: WS.buildRecordHref(workspaceRegistry, ids.FINDINGS, row.findingId) }]
          : []
      };
    });

    var wrap = el('div', 'aos-reporting__grid');
    wrap.appendChild(P.dataGrid({
      density: 'compact',
      caption: 'Testing results',
      columns: [
        { key: 'control', label: 'Control', width: '16%' },
        { key: 'procedure', label: 'Procedure', width: '30%' },
        { key: 'evidence', label: 'Evidence', width: '12%' },
        { key: 'result', label: 'Result', width: '12%' },
        { key: 'conclusion', label: 'Conclusion', width: '18%' },
        { key: 'finding', label: 'Linked findings', width: '12%' }
      ],
      rows: rows,
      emptyState: {
        icon: '◇', title: 'No testing results recorded',
        description: 'Section IV is generated directly from the Testing workspace. Results appear here as workpapers are completed.'
      }
    }));
    return wrap;
  }

  /** Builds the Section V entity-information registers, each labelled as not audited. */
  function buildEntityInformationBody(section) {
    var P = presentation();
    var wrap = el('div', 'aos-reporting__registers');
    asArray(section.registers).forEach(function (register) {
      var block = el('section', 'aos-reporting__register');
      block.appendChild(el('h4', 'aos-reporting__register-title', register.label));
      block.appendChild(el('p', 'aos-reporting__register-description', register.description));
      block.appendChild(P.dataGrid({
        density: 'compact',
        caption: register.label,
        columns: [
          { key: 'id', label: 'Reference', width: '12%' },
          { key: 'text', label: 'Description', width: '58%' },
          { key: 'criteria', label: 'Criteria', width: '15%' },
          { key: 'controls', label: 'Controls', width: '15%' }
        ],
        rows: register.rows.map(function (row) {
          return { id: row.id, cells: { id: row.id, text: row.text, criteria: row.criteria, controls: row.controls } };
        })
      }));
      wrap.appendChild(block);
    });
    return wrap;
  }

  /** Builds the System Description body: one factual block per operational domain. */
  function buildDescriptionBody(section) {
    var wrap = el('div', 'aos-reporting__blocks');
    if (section.narrative) {
      wrap.appendChild(el('p', 'aos-reporting__narrative', section.narrative));
    }
    asArray(section.blocks).forEach(function (block) {
      var node = el('div', 'aos-reporting__fact' + (block.present ? '' : ' aos-reporting__fact--absent'));
      node.appendChild(el('span', 'aos-reporting__fact-label', block.label));
      node.appendChild(el('p', 'aos-reporting__fact-text', block.text));
      wrap.appendChild(node);
    });
    return wrap;
  }

  /**
   * Builds the middle pane: the selected report section in full — its identity,
   * the continuous-generation notice, the not-audited notice where it applies,
   * its content, its AI lineage, and the change-proposal editor.
   */
  function buildSectionCanvas(section, viewModel, onPropose) {
    var P = presentation();
    var canvas = el('div', 'aos-reporting__canvas');
    if (!section) {
      canvas.appendChild(P.emptyState({
        icon: '◇', title: 'No section selected',
        description: 'Select a section from the report navigator to open it here.'
      }));
      return canvas;
    }

    var head = el('header', 'aos-reporting__canvas-head');
    head.appendChild(el('p', 'aos-reporting__canvas-eyebrow', 'Section ' + section.numeral));
    head.appendChild(el('h2', 'aos-reporting__canvas-title', section.title));
    var badges = el('div', 'aos-reporting__canvas-badges');
    if (section.sourceLabel) {
      badges.appendChild(P.statusBadge({ label: section.sourceLabel, tone: TONES.INFO }));
    }
    if (section.status) {
      badges.appendChild(P.statusBadge({ label: section.status, tone: section.statusTone }));
    }
    if (!section.audited) {
      badges.appendChild(P.statusBadge({ label: 'Not audited', tone: TONES.WARNING }));
    }
    if (!section.included) {
      badges.appendChild(P.statusBadge({ label: 'Excluded from the report', tone: TONES.WARNING }));
    }
    head.appendChild(badges);
    head.appendChild(el('p', 'aos-reporting__canvas-summary', section.summary));
    canvas.appendChild(head);

    // The continuous-generation promise, stated verbatim on every generated
    // section (Issue #41 — Continuous AI Drafting).
    if (section.generationNotice) {
      var notice = el('p', 'aos-reporting__notice aos-tint-brand', section.generationNotice);
      canvas.appendChild(notice);
    }
    if (section.notAuditedNotice) {
      canvas.appendChild(el('p', 'aos-reporting__notice aos-reporting__notice--warning', section.notAuditedNotice));
    }

    var body;
    if (!section.recorded) {
      body = P.emptyState({
        icon: '◇', title: 'This section is not recorded in the report',
        description: 'Release 1 renders only the sections the engagement’s report document declares. Nothing is drafted in its place.'
      });
    } else if (section.key === 'testing-results') {
      body = buildTestingResultsBody(section, viewModel.context.workspaceRegistry);
    } else if (section.key === 'entity-information') {
      body = section.present ? buildEntityInformationBody(section) : P.emptyState({
        icon: '◇', title: 'No entity information recorded',
        description: 'Complementary user entity controls, subservice organization controls, and the entity’s IPE procedures appear here as the entity supplies them.'
      });
    } else if (section.key === 'system-description') {
      body = buildDescriptionBody(section);
    } else {
      body = P.emptyState({
        icon: '◇', title: section.status || 'Authored at issuance',
        description: 'This section is authored as part of the report issuance process. Release 1 records its status and never drafts its wording.'
      });
    }
    canvas.appendChild(paneBlock('Content', body));

    canvas.appendChild(paneBlock('Generated from',
      buildSectionLineage(section, viewModel.context.workspaceRegistry)));

    canvas.appendChild(buildProposalEditor(section, viewModel, onPropose));
    return canvas;
  }

  /**
   * Builds the change-proposal editor (Issue #41 — Report Editing). The report
   * is never written directly: a proposed change becomes a Suggestion, the
   * impact analysis names the upstream objects it reaches, and a permissioned
   * human approves before anything propagates. An issued report is immutable,
   * so the editor explains that and offers to open a revision instead.
   */
  function buildProposalEditor(section, viewModel, onPropose) {
    var P = presentation();
    var block = el('section', 'aos-reporting__block aos-reporting__proposal');
    block.appendChild(el('h3', 'aos-reporting__block-title', 'Propose a change'));

    if (!viewModel.editability.editable) {
      block.appendChild(el('p', 'aos-reporting__notice aos-reporting__notice--warning',
        viewModel.editability.reason));
      var revision = P.button({ label: 'Open a revision', variant: 'subtle' });
      revision.addEventListener('click', function () {
        var service = versions();
        var repository = AuditOS.repository;
        if (service && repository) {
          service.openRevision(repository, viewModel.engagement.id, viewModel.reportDocument,
            'Revision opened from the Reporting workspace');
        }
      });
      block.appendChild(revision);
      return block;
    }

    block.appendChild(el('p', 'aos-reporting__proposal-help',
      'Edits never write the report directly. A proposal is analyzed for impact, becomes a suggestion, ' +
      'and propagates upstream only once it is approved: Edit → impact → suggestion → approval → propagation → regeneration.'));

    var label = el('label', 'aos-reporting__proposal-field');
    label.appendChild(el('span', 'aos-reporting__proposal-label', 'Proposed change to Section ' + section.numeral));
    var textarea = el('textarea', 'aos-reporting__proposal-input');
    textarea.setAttribute('rows', '3');
    textarea.setAttribute('placeholder', 'Describe the change this section needs');
    textarea.setAttribute('aria-label', 'Proposed change to Section ' + section.numeral);
    textarea.value = boardState.draft;
    textarea.addEventListener('input', function () { boardState.draft = textarea.value; });
    label.appendChild(textarea);
    block.appendChild(label);

    var impactMount = el('div', 'aos-reporting__proposal-impact');
    var service = propagation();
    if (service) {
      var preview = service.analyzeImpact(section, '');
      impactMount.appendChild(preview.length > 0
        ? P.itemList(preview.map(function (entry) {
          return { title: entry.label, description: entry.description, meta: entry.present ? String(entry.count) : '—' };
        }), { compact: true })
        : P.emptyState({
          icon: '◇', title: 'No upstream objects affected',
          description: 'This section is not generated from operational objects, so a change to it proposes nothing upstream.'
        }));
    }
    block.appendChild(paneBlock('Impact analysis', impactMount));

    var actions = el('div', 'aos-action-group');
    actions.setAttribute('role', 'group');
    actions.setAttribute('aria-label', 'Proposal actions');
    var submit = P.button({ label: 'Analyze impact and propose', variant: 'primary' });
    submit.addEventListener('click', function () {
      if (!textarea.value.trim()) {
        return;
      }
      onPropose(section, textarea.value.trim());
      boardState.draft = '';
      textarea.value = '';
    });
    actions.appendChild(submit);
    block.appendChild(actions);
    return block;
  }

  /**
   * Builds the right pane: AI suggestions in flight, the report version
   * history, pending report approvals, the section's lineage, the regeneration
   * plan, and the Release 1 Improvement Register entry.
   */
  function buildOperationalInspector(section, viewModel) {
    var P = presentation();
    var pane = el('div', 'aos-reporting__operational');

    // --- AI suggestions: the report-edit proposals in flight, rendered through
    // the one Suggestion card of the platform (never a second workflow).
    var suggestions = section
      ? viewModel.editSuggestions.filter(function (suggestion) {
        return asArray(suggestion.affectedReportSections).indexOf(section.id) !== -1;
      })
      : viewModel.editSuggestions;
    var suggestionBody;
    if (suggestions.length === 0) {
      suggestionBody = P.emptyState({
        icon: '✦', title: 'No suggestions in flight',
        description: 'Proposed changes to this section enter the Suggested → Reviewed → Approved → Applied workflow and appear here. AI-drafted section wording travels the same path; AI stays advisory and human approval stays mandatory.'
      });
      suggestionBody.classList.add('aos-tint-brand');
    } else {
      suggestionBody = el('div', 'aos-reporting__suggestions');
      var service = suggestionService();
      suggestions.slice(0, LIST_LIMIT).forEach(function (suggestion) {
        suggestionBody.appendChild(WS.buildSuggestionWorkflowCard(suggestion, viewModel.engagement.id,
          function (status) {
            return service && status === service.STATUS.APPLIED ? TONES.SUCCESS : TONES.INFO;
          }));
      });
    }
    pane.appendChild(paneBlock('AI suggestions', suggestionBody));

    // --- Version history: the immutable version register, plus the lifecycle
    // action the current version allows.
    pane.appendChild(paneBlock('Version history', buildVersionBody(viewModel)));

    // --- Approvals: the report edits awaiting a decision. Pending work lives
    // in the workspace that owns it now that the Work Queue is gone (Issue #41).
    pane.appendChild(paneBlock('Pending report approvals', viewModel.pendingApprovals.length > 0
      ? P.itemList(viewModel.pendingApprovals.slice(0, LIST_LIMIT).map(function (suggestion) {
        return {
          title: suggestion.title,
          description: suggestion.description || '',
          meta: suggestion.status,
          tone: TONES.WARNING
        };
      }), { compact: true })
      : P.emptyState({
        icon: '◇', title: 'No report approvals pending',
        description: 'Report edits awaiting a reviewer decision appear here.'
      })));

    // --- Lineage: the same "Generated From" the canvas shows, kept in the
    // inspector so it stays visible while the canvas is scrolled.
    pane.appendChild(paneBlock('Lineage', section
      ? buildSectionLineage(section, viewModel.context.workspaceRegistry)
      : P.emptyState({ icon: '◇', title: 'Nothing selected', description: 'Select a section to see its lineage.' })));

    // --- Regeneration: the visible proof that only affected sections
    // regenerate when an operational domain changes.
    pane.appendChild(paneBlock('Continuous regeneration', P.itemList(
      viewModel.regeneration.map(function (entry) {
        return {
          title: entry.label,
          description: 'A change regenerates: ' + entry.sections,
          meta: String(entry.count),
          tone: entry.count > 0 ? TONES.INFO : null
        };
      }), { compact: true })));

    // --- Improvement Register: the Release 1 placeholder generation entry
    // (Issue #41 — Points of Improvement). Release 2 generates the workbook.
    pane.appendChild(paneBlock('Points of improvement', buildImprovementRegisterBody(viewModel)));

    return pane;
  }

  /**
   * Builds the version history body: every recorded version oldest first, and
   * the one lifecycle action the current version allows — advance while in
   * flight, open a revision once issued. Both go through the Report Version
   * Service, which performs the audited Repository write.
   */
  function buildVersionBody(viewModel) {
    var P = presentation();
    var service = versions();
    var repository = AuditOS.repository;
    var wrap = el('div', 'aos-reporting__versions');

    wrap.appendChild(viewModel.versions.length > 0
      ? P.itemList(viewModel.versions.map(function (version) {
        return {
          title: (version.version ? 'Version ' + version.version : 'Version') + ' · ' + version.status,
          description: version.note || '',
          meta: [version.createdBy, formatDate(version.createdOn)].filter(Boolean).join(' · ') ||
            (version.baseline ? 'Recorded in the report document' : ''),
          tone: version.immutable ? TONES.SUCCESS : TONES.INFO
        };
      }), { compact: true })
      : P.emptyState({
        icon: '◇', title: 'No versions recorded',
        description: 'The report’s version register begins as soon as the report document declares a version.'
      }));

    if (!service || !repository || !viewModel.currentVersion) {
      return wrap;
    }

    var current = viewModel.currentVersion;
    var actions = el('div', 'aos-action-group');
    actions.setAttribute('role', 'group');
    actions.setAttribute('aria-label', 'Version actions');

    if (current.immutable) {
      wrap.appendChild(el('p', 'aos-reporting__note',
        'Version ' + current.version + ' is issued and immutable. Edits create a new version.'));
      var revision = P.button({ label: 'Open revision', variant: 'subtle' });
      revision.addEventListener('click', function () {
        service.openRevision(repository, viewModel.engagement.id, viewModel.reportDocument,
          'Revision opened from the Reporting workspace');
      });
      actions.appendChild(revision);
    } else {
      var next = service.nextStatus(current.status);
      if (next) {
        var advance = P.button({ label: 'Advance to ' + next, variant: 'primary' });
        advance.addEventListener('click', function () {
          service.advance(repository, viewModel.engagement.id, viewModel.reportDocument,
            'Advanced to ' + next + ' from the Reporting workspace');
        });
        actions.appendChild(advance);
      }
    }
    if (actions.firstChild) {
      wrap.appendChild(actions);
    }
    return wrap;
  }

  /**
   * Builds the Points of Improvement body — the Release 1 placeholder
   * generation entry (Issue #41). Release 2 generates an Excel workbook of
   * issue / cause / impact / recommendation / owner / priority / suggested
   * control, evidence, walkthrough and monitoring improvements / target date /
   * status. Release 1 states the columns honestly and generates nothing,
   * because there is no recorded improvement register to render.
   */
  function buildImprovementRegisterBody(viewModel) {
    var P = presentation();
    var wrap = el('div', 'aos-reporting__improvement');
    var empty = P.emptyState({
      icon: '✦', title: 'Improvement register — Release 2',
      description: 'Release 2 generates an Excel improvement register from the approved report: issue, cause, impact, ' +
        'recommendation, owner, priority, suggested control / evidence / walkthrough / monitoring improvements, target date, and status. ' +
        'Release 1 provides this generation entry and fabricates no improvements.'
    });
    empty.classList.add('aos-tint-brand');
    wrap.appendChild(empty);

    // The generation entry exists in Release 1 and refuses honestly, so the
    // seam is real rather than a button that silently does nothing.
    var button = P.button({ label: 'Generate improvement register', variant: 'subtle' });
    var status = el('p', 'aos-reporting__note');
    button.addEventListener('click', function () {
      status.textContent = 'No improvement register is recorded for ' +
        (viewModel.engagement.engagementCode || 'this engagement') +
        '. Release 2 generates it from the approved report; Release 1 never fabricates one.';
    });
    wrap.appendChild(button);
    wrap.appendChild(status);
    return wrap;
  }

  // ------------------------------------------------------------------
  // Slot rendering
  // ------------------------------------------------------------------

  /** Replaces a slot's content with the given nodes (or clears it). */
  var fillSlot = WS.fillSlot;

  /**
   * Hides the framework's supporting-panel band for this workspace: the
   * Workbench's own right pane IS the supporting information, so the band below
   * would duplicate it and push the application below the fold (Issue #40 §2).
   */
  function collapseSupportingRegions(view) {
    var panels = view.querySelector('[data-region="supporting-panels"]');
    if (panels) {
      panels.hidden = true;
    }
  }

  /** The export context the document serializers frame the document with. */
  function exportContext(viewModel) {
    return {
      clientName: viewModel.company ? viewModel.company.name : viewModel.engagement.companyId,
      engagementName: viewModel.engagement.name || '',
      engagementCode: viewModel.engagement.engagementCode || ''
    };
  }

  /** Wires the header export actions to the Document Export service. */
  function bindExportActions(view, viewModel) {
    var service = exporter();
    if (!service) {
      return;
    }
    var context = exportContext(viewModel);
    [
      { id: ACTIONS.DOCX, run: function () { service.downloadDocx(viewModel.report, context); } },
      { id: ACTIONS.PDF, run: function () { service.downloadPdf(viewModel.report, context); } },
      { id: ACTIONS.HTML, run: function () { service.downloadHtml(viewModel.report, context); } }
    ].forEach(function (action) {
      var node = view.querySelector('[data-action="' + action.id + '"]');
      if (node) {
        node.addEventListener('click', action.run);
      }
    });
  }

  /**
   * Records a proposed section edit: the impact analysis names the upstream
   * objects, the proposal becomes a Suggestion awaiting approval, and the
   * report hop is published so the change is inspectable in the Audit Log from
   * the moment it is raised. Nothing about the report itself is written —
   * propagation upstream happens only once the suggestion is approved.
   */
  function proposeSectionEdit(viewModel, section, text) {
    var service = propagation();
    var repository = AuditOS.repository;
    if (!service || !repository) {
      return null;
    }
    var proposal = service.proposeEdit(repository, viewModel.engagement.id, section, text);
    if (proposal) {
      service.propagate(viewModel.engagement.id, section, [],
        'Report edit proposed for Section ' + section.numeral);
      requestImpactReasoning(viewModel, section, text, proposal);
    }
    return proposal;
  }

  /**
   * Asks the Impact Agent to sharpen the advisory text on an edit proposal.
   *
   * Fired after the proposal exists, never before it: the suggestion is created
   * with the structural impact description synchronously, so the edit is filed
   * and visible whether or not any AI is reachable. The agent then rewrites
   * that advisory text in place if it can, which republishes and re-renders
   * this workspace through the ordinary state subscription. It proposes no
   * change of its own — the edit remains the only thing awaiting a decision.
   */
  function requestImpactReasoning(viewModel, section, text, proposal) {
    var agent = AuditOS.impactAgent;
    if (!agent || !proposal || !proposal.suggestion) {
      return;
    }
    agent.requestReasoning({
      engagementId: viewModel.engagement.id,
      suggestion: proposal.suggestion,
      impact: proposal.impact,
      sectionLabel: 'Section ' + (section.numeral || section.id) + ' — ' + (section.title || ''),
      editText: text
    });
  }

  /**
   * Renders the ready reporting experience: the fixed-frame viewport shell
   * hosting one Workbench — report navigator, selected section, operational
   * inspector — with the report health strip and audit lineage in the compact
   * context band above it.
   */
  function renderReady(view, viewModel) {
    var P = presentation();
    var router = AuditOS.router;
    var targetId = router && router.getCurrentRecordId ? router.getCurrentRecordId() : '';

    AuditOS.workspaceFramework.configure(view, {
      shell: 'viewport',
      header: viewModel.header,
      contextSummary: viewModel.ribbon
    });
    collapseSupportingRegions(view);
    bindExportActions(view, viewModel);

    var canvas = el('div', 'aos-reporting');
    canvas.setAttribute('data-canvas', 'flush');

    var band = el('div', 'aos-reporting__band');
    var health = buildHealthStrip(viewModel.reportHealth);
    health.classList.add('aos-reporting__health');
    band.appendChild(health);
    if (viewModel.lineage.length > 0) {
      band.appendChild(buildLineageBody(viewModel.lineage));
    }
    canvas.appendChild(band);

    var canvasMount = el('div', 'aos-reporting__canvas-mount');
    var inspectorMount = el('div', 'aos-reporting__inspector-mount');

    function onPropose(section, text) {
      proposeSectionEdit(viewModel, section, text);
    }

    function selectSection(section) {
      boardState.sectionId = section && section.id ? section.id : '';
      canvasMount.replaceChildren(buildSectionCanvas(section, viewModel, onPropose));
      inspectorMount.replaceChildren(buildOperationalInspector(section, viewModel));
    }

    // A record-level deep link selects that section once per navigation; after
    // that the user's own selection stands, so a state refresh never yanks the
    // pane back to the routed section.
    var preferredId = targetId && targetId !== boardState.lastTargetId ? targetId : boardState.sectionId;
    boardState.lastTargetId = targetId;

    var workbench = P.workbench({
      rail: viewModel.navigator.length > 0
        ? buildNavigatorRail(viewModel, preferredId, selectSection)
        : P.emptyState({
          icon: '◇', title: 'No report yet',
          description: 'The report exists from engagement creation and evolves continuously. Its sections appear here once the engagement records a report document.'
        }),
      canvas: canvasMount,
      inspector: inspectorMount,
      railRatio: 22,
      inspectorRatio: 27,
      railLabel: 'Report navigator',
      canvasLabel: 'Selected report section',
      inspectorLabel: 'Report operational inspector'
    });
    workbench.classList.add('aos-rise-in');
    canvas.appendChild(workbench);

    if (viewModel.navigator.length === 0) {
      selectSection(null);
    }

    fillSlot(view, SLOTS.CONTENT, [canvas]);
    fillSlot(view, SLOTS.FOOTER, [buildFooterItems(viewModel.footer)]);
  }

  /** Renders the layout-stable loading state (§15.12 — Loading). */
  function renderLoading(view) {
    var P = presentation();
    fillSlot(view, SLOTS.CONTENT, [P.loadingState({ variant: 'detail', label: 'Loading the report' })]);
  }

  /** Renders the degraded state (§15.12 — Empty / Error). */
  function renderDegraded(view, viewModel) {
    var P = presentation();
    fillSlot(view, SLOTS.CONTENT, [P.emptyState({
      icon: '◇', title: 'No engagement available',
      description: 'The Shared Audit State holds no engagement to present' +
        (viewModel.status && viewModel.status.degradedReason ? ' (' + viewModel.status.degradedReason + ')' : '') +
        '. Regenerate the demo-data bundle and reload to restore the Reporting Workspace.'
    })]);
  }

  // ------------------------------------------------------------------
  // Wiring — follows the router and the Shared Audit State.
  // ------------------------------------------------------------------

  /**
   * Renders the Reporting Workspace when it is the active workspace: the ready
   * experience once the state has loaded, the loading skeleton before that, and
   * the degraded explanation when no engagement is available.
   */
  function renderActiveReporting() {
    var registry = AuditOS.workspaceRegistry;
    var router = AuditOS.router;
    var state = AuditOS.state;
    if (!registry || !router || !AuditOS.workspaceFramework || !AuditOS.presentation) {
      return;
    }
    if (router.getCurrentWorkspaceId() !== registry.IDS.REPORTING) {
      return;
    }

    var view = global.document.querySelector(
      '.aos-workspace-view[data-workspace="' + registry.IDS.REPORTING + '"]'
    );
    if (!view) {
      return;
    }

    var routeContext = router.getCurrentContext ? router.getCurrentContext() : null;
    var viewModel = state ? collectViewModel(state, registry, routeContext) : null;
    if (!viewModel) {
      renderLoading(view);
      return;
    }
    if (viewModel.degraded) {
      renderDegraded(view, viewModel);
      return;
    }
    renderReady(view, viewModel);
    requestNarrativeDraft(viewModel);
  }

  /**
   * Asks the Narrative Agent to draft the System Description's prose.
   *
   * Fired after the render, never before it: drafting is a network round trip
   * and the report must never wait on one. The agent declines by itself when
   * there is nothing to do — no AI backend, no recorded facts, a narrative
   * already approved, or a draft already awaiting a decision — so this stays a
   * single unconditional call. A filed draft is a state write, which republishes
   * and re-renders this workspace through the ordinary state subscription, and
   * the drafted paragraph appears in the inspector as a suggestion awaiting
   * review. Nothing reaches the report itself until a human approves it.
   */
  function requestNarrativeDraft(viewModel) {
    var agent = AuditOS.narrativeAgent;
    if (!agent || !viewModel || !viewModel.engagement || !viewModel.report) {
      return;
    }
    asArray(viewModel.report.sections).forEach(function (section) {
      if (section.key === agent.SECTION_KEY) {
        agent.requestDraft({ engagementId: viewModel.engagement.id, section: section });
      }
    });
  }

  AuditOS.reportingWorkspace = {
    SLOTS: SLOTS,
    ACTIONS: ACTIONS,

    // Pure, offline-testable derivations.
    derivations: {
      formatDate: formatDate,
      formatPeriod: formatPeriod,
      normalizeFrameworks: normalizeFrameworks,
      deriveOperational: deriveOperational,
      isApprovedObservation: isApprovedObservation,
      deriveReportHealth: deriveReportHealth,
      deriveLineage: deriveLineage,
      deriveNavigator: deriveNavigator,
      deriveRegenerationPlan: deriveRegenerationPlan,
      deriveRelationships: deriveRelationships,
      deriveMetadata: deriveMetadata
    },

    collectViewModel: collectViewModel,

    /**
     * Binds the Reporting Workspace to the router and the Shared Audit State.
     * Safe to call once, after the DOM is ready, the router has resolved the
     * initial route, and the framework has rendered its skeleton. Does nothing
     * when the routing or state foundations are absent, so the shell degrades
     * rather than throwing.
     */
    init: function () {
      var router = AuditOS.router;
      var state = AuditOS.state;
      if (!AuditOS.workspaceRegistry || !router) {
        return;
      }

      global.document.addEventListener(router.ROUTE_CHANGED_EVENT, renderActiveReporting);
      if (state && typeof state.subscribe === 'function') {
        state.subscribe(state.EVENTS.STATE_LOADED, renderActiveReporting);
        state.subscribe(state.EVENTS.STATE_CHANGED, renderActiveReporting);
        state.subscribe(state.EVENTS.STATE_RESET, renderActiveReporting);
      }
      renderActiveReporting();
    }
  };

  // Self-initialize after the DOM is ready. Guarded so the module can load in
  // the offline test sandbox, where no document exists.
  if (global.document) {
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', AuditOS.reportingWorkspace.init);
    } else {
      AuditOS.reportingWorkspace.init();
    }
  }
})(window);
