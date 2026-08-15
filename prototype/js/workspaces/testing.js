/**
 * AuditOS Testing Workspace
 * Workspaces and Navigation — Chapter 12 / Workspace Architecture — Chapter 61 /
 * Audit Lifecycle — Chapter 11 / Component Architecture — Chapter 74
 *
 * The operational workspace where auditors perform and manage assurance testing
 * for an engagement (GitHub Issue #24). Testing is not a standalone activity: it
 * is the validation of controls using evidence — the point where audit knowledge
 * becomes audit assurance. Release 1 is a faithful visualization of the current
 * testing JSON — no AI, no backend, no writes, no workflow engine. In Release 2
 * AI agents will draft test procedures, recommend sample selections, identify
 * testing gaps, evaluate evidence, and propose conclusions; this workspace opens
 * those seams without implementing them, rendering only the current testing state
 * and never fabricating a testing outcome or inferring a business conclusion.
 *
 * Architecture: Business → ViewModel → Components → DOM, identical to the
 * Engagement, Walkthrough, Evidence, Requirements, and Controls workspaces.
 * `collectViewModel` is the single place this workspace reads `AuditOS.state`; it
 * returns a declarative model of pure, offline-testable derivations. The renderer
 * configures the Shared Workspace Framework's inherited skeleton
 * (`AuditOS.workspaceFramework.configure`) and fills its slots with compositions
 * from the Enterprise Data Presentation System (`AuditOS.presentation`) — no
 * bespoke primitives, no duplicated components (Component Design Patterns §81.4 —
 * Composition Over Duplication).
 *
 * Tests are read through the same engagement-scoped document pattern as controls,
 * evidence, and findings (`findDatasetsForEngagement` / `getDocument`). Each test
 * record is one procedure executed against one sample and carries its recorded
 * status ("Completed" / "Pending") and result ("Pass" / "Fail" / none). Every
 * read normalizes across the demo shapes — a SOC 2 shape and an ISO 27001 shape
 * that additionally carries `framework`, `annexASection`, and a `frameworkReuse`
 * block — and fabricates nothing where a field is absent. A test's related
 * control resolves to a real name only when its `libraryControlId` joins the
 * shared control library or its `controlId` joins the engagement control set;
 * otherwise it renders the raw identifier (never a fabricated label). The tester
 * and reviewer are recorded as user identifiers for which the demo carries no
 * directory, so they render as their raw identifiers rather than an invented
 * name. A recorded `findingId` resolves to the real finding it raised. This keeps
 * the workspace faithful across the mixed datasets while opening the Release 2
 * seams (AI-assisted testing, methodology reuse).
 *
 * The generated workpaper is the primary operational surface (Issue #40 §3).
 * Testing is not a queue of test rows: it is the audit workpaper for a selected
 * control, generated from what the engagement records and regenerated the
 * instant another control is selected. The viewport shell fixes the frame and
 * the shared Workbench divides it into three panes that each own their scrolling:
 *
 *   Left    the control selector — search, status, and every control
 *   Middle  the generated worksheet — Overview, Control description, Walkthrough
 *           summary, Testing objective, Testing procedure, Population, Evidence
 *           references, Attributes, Exceptions, Conclusion, Reviewer notes,
 *           Approval — every section editable except its AI provenance
 *   Right   review, AI, and provenance — the workpaper's canonical status, the
 *           in-flight review workflow, AI advisory, and the complete AI lineage
 *
 * The worksheet model itself is NOT defined here. It comes from the canonical
 * Workpaper Service (js/services/workpaper-service.js), which the HTML document
 * and the Excel workbook read from too, so the screen, the document, and the
 * workbook can never disagree about what the workpaper says (§6).
 *
 * Editing (§3 / §5). A section edit never writes production state: it enters the
 * canonical Suggested → Reviewed → Approved → Applied lifecycle through the
 * shared Suggestion Lifecycle Service, and the shared workflow card renders the
 * decision. Release 1 builds the workflow; Release 2 performs the AI propagation
 * back through walkthrough, evidence, and controls.
 *
 * Status (§11). Testing declares no status model of its own — the recorded
 * status renders verbatim and its phase, tone, and order come from the canonical
 * lifecycle, the same one Evidence reads.
 *
 * The Test Procedure Queue derivations remain: they still describe the
 * engagement's testing health, progress, exceptions, and per-test inspector, and
 * `renderInspector` still exposes the host-agnostic test rail → Test Inspector
 * for any other host to mount. Nothing about them was re-derived or duplicated.
 *
 * Presentation only. Every business value is read through `AuditOS.state`;
 * nothing is written. Sections with no data render shared Empty State
 * components; nothing is fabricated. The AI surface is a reserved presentation
 * region — AI stays advisory and human approval remains mandatory.
 *
 * Structure of this file (Coding Standards §30.8): constants, pure derivation
 * helpers (no DOM, no state access), the view-model collector (the single state
 * read), generic DOM builders (compose the presentation system), slot
 * renderers, and the route / state wiring.
 *
 * Loaded as a classic script so the prototype runs directly from
 * file:///.../prototype/index.html with no build step or module loader.
 */
(function (global) {
  'use strict';

  var AuditOS = global.AuditOS = global.AuditOS || {};

  /** Shared Workspace Platform (Issue #27) — harmonized helpers reused across every operational workspace. */
  var WS = AuditOS.workspaceShared || {};

  /** Cross-Workspace Relationship Engine (Issue #30) — shared relationship/derivation layer. */
  var RE = AuditOS.relationships || {};

  /** The canonical workpaper model (Issue #40) — resolved at call time. */
  function workpapers() {
    return AuditOS.workpaperService || null;
  }

  /** The canonical workpaper serializers (Issue #40 §6) — resolved at call time. */
  function workpaperExport() {
    return AuditOS.workpaperExport || null;
  }

  /** The canonical AI Lineage Service (Issue #39 / §10) — resolved at call time. */
  function lineageService() {
    return AuditOS.aiLineage || null;
  }

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

  /**
   * Test operational-status vocabulary → tone (read, never invented). The
   * production dataset's `status`/`testingStatus` mirror the shared
   * testingStatus vocabulary (enums.json) — "Data not received", "Pending",
   * "In Progress", "Completed", "Not Applicable"; the vocabulary also covers
   * the operational states a test moves through — Not Started, Pending
   * Review, Retesting Required — so a future or differently sourced dataset
   * (including AI-assisted states) reads through the same token-backed tones.
   * An unmapped status resolves to a neutral info tone.
   */
  var STATUS_TONES = {
    'Not Started': null,
    'Data not received': TONES.WARNING,
    'Pending': TONES.WARNING,
    'In Progress': TONES.INFO,
    'Pending Review': TONES.WARNING,
    'Retesting Required': TONES.WARNING,
    'Completed': TONES.SUCCESS,
    'Not Applicable': null
  };

  /** Test-result vocabulary → tone. Pass reads success, Fail reads exception; no result reads neutral. */
  var RESULT_TONES = { 'Pass': TONES.SUCCESS, 'Fail': TONES.ERROR };

  /**
   * Canonical order for the Testing Health strip so its indicators read in a
   * stable operational sequence regardless of which statuses the data contains.
   * Statuses outside this list sort after it, alphabetically.
   */
  var HEALTH_ORDER = ['Not Started', 'Data not received', 'Pending', 'In Progress', 'Pending Review', 'Retesting Required', 'Completed', 'Not Applicable'];

  /** Evidence-status keys derived per test, with their labels and tones. */
  var EVIDENCE_STATUS = {
    USED: { key: 'used', label: 'Evidence recorded', tone: TONES.SUCCESS },
    OUTSTANDING: { key: 'outstanding', label: 'Evidence outstanding', tone: TONES.WARNING }
  };

  /** The three presentation modes over the one test queue. */
  var VIEWS = { TEST: 'test', CONTROL: 'control', RESULT: 'result' };

  /** Result-group descriptors for the By-result view, exceptions first. */
  var RESULT_GROUPS = {
    FAIL: { key: 'Fail', label: 'Exceptions' },
    PASS: { key: 'Pass', label: 'Passed' },
    PENDING: { key: 'Pending', label: 'Awaiting result' }
  };

  /** Maximum entries per supporting list so panels stay scannable. */
  var LIST_LIMIT = WS.LIST_LIMIT;

  // ------------------------------------------------------------------
  // Pure derivation helpers — no DOM, no AuditOS.state access. Each takes plain
  // records and returns plain view data, so the offline unit suites exercise
  // them directly (derived values remain derived, §30.12).
  // ------------------------------------------------------------------

  /** Returns the value when it is an array, otherwise an empty array. */
  var asArray = WS.asArray;

  /** Formats an ISO `YYYY-MM-DD` date as a compact, deterministic label. */
  var formatDate = WS.formatDate;

  /** Formats a `{ startDate, endDate }` period as `start – end`. */
  var formatPeriod = WS.formatPeriod;

  /**
   * The frameworks attached to an engagement, always as an array. Identical
   * Release 1 → Release 2 seam as the other workspaces: a future engagement with
   * a `frameworks` array renders every entry; today's single `framework` string
   * becomes a one-element array; neither yields an empty array.
   */
  var normalizeFrameworks = WS.normalizeFrameworks;

  /** The current engagement: identical rule to Home, Engagement, Walkthrough, Evidence, Requirements, and Controls. */
  var deriveCurrentEngagement = WS.deriveCurrentEngagement;

  /** Resolves a test status to a presentation tone. */
  function resolveStatusTone(status) {
    return Object.prototype.hasOwnProperty.call(STATUS_TONES, status) ? STATUS_TONES[status] : TONES.INFO;
  }

  /** Resolves a test result to a presentation tone (neutral when there is no result). */
  function resolveResultTone(result) {
    return Object.prototype.hasOwnProperty.call(RESULT_TONES, result) ? RESULT_TONES[result] : null;
  }

  /**
   * The control a test validates, resolved only where an identifier genuinely
   * joins: the shared control library by `libraryControlId` first (the master
   * definition every engagement references), then the engagement control set by
   * `controlId`. A test whose identifiers join neither renders its raw
   * `controlId` with no title — never a fabricated control. Returns
   * `{ id, code, title }`.
   */
  function resolveRelatedControl(test, context) {
    return RE.resolveControlRef(test, context);
  }

  /** A compact related-control label — code + title where they resolve, else the raw identifier. */
  function relatedControlLabel(related) {
    return RE.controlRefLabel(related);
  }

  /**
   * The evidence status of a test, derived only from the working paper the record
   * links: recorded when a working paper is present, outstanding otherwise. Never
   * fabricated — a test with no working paper reads Outstanding, the faithful
   * current state.
   */
  function deriveEvidenceStatus(test) {
    var source = test || {};
    if (source.workingPaperId) {
      return { key: EVIDENCE_STATUS.USED.key, label: EVIDENCE_STATUS.USED.label, tone: EVIDENCE_STATUS.USED.tone };
    }
    return { key: EVIDENCE_STATUS.OUTSTANDING.key, label: EVIDENCE_STATUS.OUTSTANDING.label, tone: EVIDENCE_STATUS.OUTSTANDING.tone };
  }

  /**
   * The methodology-reuse posture of a test, drawn only from the reuse block the
   * record carries: the SOC 2 `knowledgeReuse` shape (cross-engagement
   * methodology inheritance) or the ISO `frameworkReuse` shape (cross-framework
   * methodology reuse). A test declaring neither reads not-applicable with no
   * source — never a fabricated reuse claim.
   */
  function normalizeMethodologyReuse(test) {
    var source = test || {};
    if (source.knowledgeReuse && typeof source.knowledgeReuse === 'object') {
      return {
        kind: 'knowledge',
        methodologyInherited: Boolean(source.knowledgeReuse.methodologyInherited),
        source: source.knowledgeReuse.sourceEngagementId || '',
        evidenceReviewed: Boolean(source.knowledgeReuse.evidenceReuseReviewed)
      };
    }
    if (source.frameworkReuse && typeof source.frameworkReuse === 'object') {
      return {
        kind: 'framework',
        methodologyInherited: Boolean(source.frameworkReuse.soc2MethodologyReusable),
        source: source.frameworkReuse.sourceFramework || '',
        evidenceReviewed: Boolean(source.frameworkReuse.evidenceReusable)
      };
    }
    return { kind: null, methodologyInherited: false, source: '', evidenceReviewed: false };
  }

  /**
   * One Test Procedure Queue row, resolved to display fields. The related control
   * resolves to a name where its identifiers genuinely join and renders the raw
   * identifier otherwise; the tester renders as recorded (no directory joins the
   * demo user identifiers); evidence status is derived only from what the record
   * carries. The test record is carried through for the Inspector.
   */
  function deriveTestRow(test, context) {
    var source = test || {};
    var related = resolveRelatedControl(source, context);
    return {
      id: source.id || '',
      test: source,
      procedure: source.procedure || '',
      control: related,
      controlLabel: relatedControlLabel(related),
      testedBy: source.testedBy || '',
      reviewedBy: source.reviewedBy || '',
      status: source.status || '',
      statusTone: resolveStatusTone(source.status),
      result: source.result || '',
      resultTone: resolveResultTone(source.result),
      method: source.procedure || '',
      evidence: deriveEvidenceStatus(source),
      findingId: source.findingId || ''
    };
  }

  /**
   * The Test Procedure Queue — every test rendered once, ordered by identifier so
   * the surface is stable. Nothing is capped or filtered: the queue is the full
   * operational dataset the presentation views regroup.
   */
  function deriveQueue(tests, context) {
    return asArray(tests)
      .map(function (test) { return deriveTestRow(test, context); })
      .sort(function (a, b) { return String(a.id).localeCompare(String(b.id)); });
  }

  /**
   * The Testing Health strip — one indicator per operational status actually
   * present (labelled by the status, valued by its real count), in canonical
   * order, plus derived Passed, Exceptions, and Pending review indicators. Every
   * value is a real count of real records; an engagement with no tests yields only
   * the derived indicators, reading None / Clear. Never a fabricated count.
   */
  function deriveTestingHealth(tests) {
    var list = asArray(tests);
    var counts = {};
    list.forEach(function (test) {
      var status = test && test.status ? test.status : 'Unspecified';
      counts[status] = (counts[status] || 0) + 1;
    });

    var statuses = Object.keys(counts).sort(function (a, b) {
      var ia = HEALTH_ORDER.indexOf(a);
      var ib = HEALTH_ORDER.indexOf(b);
      if (ia === -1 && ib === -1) { return a.localeCompare(b); }
      if (ia === -1) { return 1; }
      if (ib === -1) { return -1; }
      return ia - ib;
    });

    var indicators = statuses.map(function (status) {
      return {
        key: 'status-' + status.toLowerCase().replace(/\s+/g, '-'),
        label: status,
        status: String(counts[status]),
        tone: resolveStatusTone(status)
      };
    });

    var passed = list.filter(function (test) { return test && test.result === 'Pass'; }).length;
    indicators.push({
      key: 'passed',
      label: 'Passed',
      status: passed > 0 ? String(passed) : 'None',
      tone: passed > 0 ? TONES.SUCCESS : null
    });

    var exceptions = list.filter(function (test) { return test && test.result === 'Fail'; }).length;
    indicators.push({
      key: 'exceptions',
      label: 'Exceptions',
      status: exceptions > 0 ? String(exceptions) : 'Clear',
      tone: exceptions > 0 ? TONES.ERROR : TONES.SUCCESS
    });

    var awaiting = list.filter(function (test) { return test && !test.result; }).length;
    indicators.push({
      key: 'awaiting-result',
      label: 'Awaiting result',
      status: awaiting > 0 ? String(awaiting) : 'Clear',
      tone: awaiting > 0 ? TONES.WARNING : TONES.SUCCESS
    });

    return indicators;
  }

  /**
   * Testing progress — real counts only: completed tests over total tests, with
   * the passed / exception / pending breakdown. No estimated percentage; the
   * ratio is a real measurement of the recorded tests, and an engagement with no
   * tests reads zero rather than a fabricated figure.
   */
  function deriveTestingProgress(tests) {
    var list = asArray(tests);
    var completed = list.filter(function (test) { return test && test.status === 'Completed'; }).length;
    var passed = list.filter(function (test) { return test && test.result === 'Pass'; }).length;
    var failed = list.filter(function (test) { return test && test.result === 'Fail'; }).length;
    var pending = list.length - completed;
    return { total: list.length, completed: completed, passed: passed, failed: failed, pending: pending };
  }

  /**
   * The overall testing status for the header badge: Not Started when there are
   * no tests, Completed once every test is Completed, In Progress otherwise.
   * Derived from real status counts; never a fabricated aggregate.
   */
  function deriveTestingStatus(tests) {
    var list = asArray(tests);
    if (list.length === 0) {
      return { label: 'Not Started', tone: null };
    }
    var completed = list.filter(function (test) { return test.status === 'Completed'; }).length;
    if (completed === list.length) {
      return { label: 'Completed', tone: TONES.SUCCESS };
    }
    return { label: 'In Progress', tone: TONES.INFO };
  }

  /**
   * Actual exceptions only — the tests whose recorded result is Fail, resolved to
   * their raised finding where the `findingId` joins the findings collection. No
   * placeholder findings: a test with no failure never appears, and an engagement
   * with no exceptions yields an empty list and the shared Empty State.
   */
  function deriveExceptions(tests, context) {
    var ctx = context || {};
    return asArray(tests)
      .filter(function (test) { return test && test.result === 'Fail'; })
      .map(function (test) {
        var related = resolveRelatedControl(test, ctx);
        var finding = test.findingId && ctx.findingsById ? ctx.findingsById[test.findingId] : null;
        return {
          id: test.id,
          title: finding && finding.title ? finding.title : (test.actualResult || 'Exception identified'),
          control: relatedControlLabel(related),
          findingId: test.findingId || '',
          severity: finding && finding.severity ? finding.severity : '',
          tone: TONES.ERROR
        };
      })
      .sort(function (a, b) { return String(a.id).localeCompare(String(b.id)); });
  }

  /**
   * The workpaper selector rows (Issue #40 §3 — Left Panel): one row per
   * control the engagement holds, carrying the workpaper recorded against it
   * where one exists. A control with no workpaper still appears — an untested
   * control is a real, current fact about the engagement, and hiding it would
   * misrepresent testing coverage — and reads "Not started" rather than a
   * fabricated status.
   */
  function deriveWorkpaperRows(controls, tests) {
    var byControlId = {};
    asArray(tests).forEach(function (test) {
      if (test && test.controlId && !byControlId[test.controlId]) {
        byControlId[test.controlId] = test;
      }
    });
    return asArray(controls).map(function (control) {
      var source = control || {};
      var test = byControlId[source.id] || null;
      var status = (test && (test.testingStatus || test.status)) || source.testingStatus || '';
      return {
        id: source.id || '',
        control: source,
        test: test,
        controlCode: source.controlCode || source.controlId || source.id || '',
        title: source.title || source.id || '',
        family: source.family || source.category || '',
        workpaperId: test && test.id ? test.id : '',
        status: status,
        statusTone: status ? resolveStatusTone(status) : null,
        result: (test && test.result) || '',
        resultTone: resolveResultTone(test && test.result),
        generated: Boolean(test)
      };
    }).sort(function (a, b) { return String(a.controlCode).localeCompare(String(b.controlCode)); });
  }

  /**
   * Whether a workpaper selector row matches a free-text query. Matching is
   * case-insensitive across the fields the row displays, so what the user reads
   * is what the search looks at. An empty query matches everything.
   */
  function matchesSearch(row, query) {
    var needle = String(query || '').trim().toLowerCase();
    if (!needle) {
      return true;
    }
    return [row.controlCode, row.title, row.family, row.status, row.result, row.workpaperId]
      .filter(Boolean)
      .some(function (field) {
        return String(field).toLowerCase().indexOf(needle) !== -1;
      });
  }

  /**
   * The suggestions that genuinely target one workpaper: those naming its
   * control or its workpaper record. A suggestion naming neither is never
   * attributed to it.
   */
  function deriveWorkpaperSuggestions(row, suggestions) {
    var keys = [row && row.id, row && row.controlCode, row && row.workpaperId].filter(Boolean);
    if (keys.length === 0) {
      return [];
    }
    return asArray(suggestions).filter(function (suggestion) {
      var references = asArray(suggestion.affectedControls).concat(asArray(suggestion.auditReferences));
      return keys.some(function (key) { return references.indexOf(key) !== -1; });
    });
  }

  // ---- Presentation views — three regroupings of the one queue dataset. Each is
  // pure and returns `{ groups: [{ label, rows }] }` from the same rows, so
  // changing the view changes presentation only and never the data.

  /** Test view — the flat queue, a single unlabeled group. */
  function testView(rows) {
    return { id: VIEWS.TEST, groups: [{ label: '', rows: asArray(rows).slice() }] };
  }

  /** By control — the same rows grouped by related control, groups ordered by label. */
  function controlGroupView(rows) {
    var groups = {};
    var order = [];
    asArray(rows).forEach(function (row) {
      var key = row.controlLabel || 'Unassigned control';
      if (!groups[key]) {
        groups[key] = [];
        order.push(key);
      }
      groups[key].push(row);
    });
    order.sort(function (a, b) { return a.localeCompare(b); });
    return { id: VIEWS.CONTROL, groups: order.map(function (key) { return { label: key, rows: groups[key] }; }) };
  }

  /** By result — the same rows grouped by test result, exceptions first, then passed, then awaiting. */
  function resultView(rows) {
    var ORDER = [RESULT_GROUPS.FAIL, RESULT_GROUPS.PASS, RESULT_GROUPS.PENDING];
    var groups = {};
    asArray(rows).forEach(function (row) {
      var key = row.result === 'Fail' ? RESULT_GROUPS.FAIL.key
        : row.result === 'Pass' ? RESULT_GROUPS.PASS.key
        : RESULT_GROUPS.PENDING.key;
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(row);
    });
    var present = ORDER.filter(function (descriptor) { return groups[descriptor.key]; });
    return {
      id: VIEWS.RESULT,
      groups: present.map(function (descriptor) { return { label: descriptor.label, rows: groups[descriptor.key] }; })
    };
  }

  /**
   * The three presentation views over one dataset, each with a switcher label and
   * its regrouped structure. The row set is identical across all three; only the
   * grouping and ordering differ.
   */
  function deriveViews(rows) {
    return [
      { id: VIEWS.TEST, label: 'Test view', view: testView(rows) },
      { id: VIEWS.CONTROL, label: 'By control', view: controlGroupView(rows) },
      { id: VIEWS.RESULT, label: 'By result', view: resultView(rows) }
    ];
  }

  /**
   * The Audit Lineage — Walkthrough → Requirement → Control → Evidence → Testing
   * → Finding → Report, with Testing highlighted as the object this workspace
   * owns. Each node carries its real, current count for the engagement and a link
   * into its workspace; nodes with no data read "—" and never a fabricated
   * figure. Only the counts vary with the data; the chain is the audit
   * methodology's real shape.
   */
  function deriveLineage(workspaceRegistry, operational) {
    if (!workspaceRegistry) {
      return [];
    }
    var ops = operational || {};
    var requirements = ops.requirements || {};
    var controls = ops.controls || {};
    var evidence = ops.evidence || {};
    var testing = ops.testing || {};
    var findings = ops.findings || {};
    var report = ops.report || null;
    var ids = workspaceRegistry.IDS;

    var nodes = [
      { id: ids.WALKTHROUGH, label: 'Walkthrough', count: null, present: false, hint: 'Knowledge acquisition' },
      { id: ids.CONTROLS, label: 'Control', count: controls.controls || 0, present: (controls.controls || 0) > 0, hint: 'What testing validates' },
      { id: ids.EVIDENCE, label: 'Evidence', count: evidence.evidenceItems || 0, present: (evidence.evidenceItems || 0) > 0, hint: 'What testing inspects' },
      { id: ids.TESTING, label: 'Testing', count: testing.tests || 0, present: (testing.tests || 0) > 0, hint: 'How the control is validated', highlighted: true },
      { id: ids.FINDINGS, label: 'Finding', count: findings.findings || 0, present: (findings.findings || 0) > 0, hint: 'What the testing surfaces' },
      { id: ids.REPORTING, label: 'Report', count: report ? null : 0, present: Boolean(report), hint: report ? report.status : 'Not started' }
    ];

    return WS.resolveLineageNodes(workspaceRegistry, nodes);
  }

  /**
   * Recent testing-related activity, newest first, drawn only from dated history
   * the tests carry (activity / history entries, or a recorded update timestamp).
   * The current demo tests record no dated events, so this yields an empty feed
   * and the shared Empty State — never a fabricated event. Release 2's AI-assisted
   * testing populates this seam.
   */
  function deriveActivity(tests) {
    return RE.deriveActivityFromHistory(tests, {
      entityNoun: 'Test',
      getSubject: function (record) { return record.id || ''; },
      resolveTone: resolveStatusTone,
      formatDate: formatDate,
      limit: LIST_LIMIT
    });
  }

  /**
   * Testing document metadata: created / modified / owner / version / tags /
   * source, derived from the testing document metadata, the engagement, and the
   * company. Only fields with real values are surfaced by the builder.
   */
  function deriveMetadata(testingMetadata, engagement, company, tests) {
    return RE.deriveCollectionMetadata(testingMetadata, engagement, company, tests, formatDate);
  }

  // ---- Inspector configuration — pure, host-agnostic (§9). Returns plain
  // Inspector Panel configuration; no DOM. Related control, sample selection,
  // evidence, methodology reuse, and the approval reflection render only when the
  // JSON records them; conclusions are never fabricated.

  /** One text-valued Inspector section rendered as a single placeholder-capable list row. */
  function textSection(title, text, placeholder) {
    return WS.textSection(title, text, placeholder);
  }

  /** One list-valued Inspector section; an empty list renders one placeholder row. */
  function listSection(title, items, placeholder) {
    return WS.listSection(title, items, placeholder);
  }

  /**
   * The methodology-reuse facts of a test, drawn only from the reuse block it
   * records. A test with no reuse block yields an empty array and the reserved
   * placeholder — never a fabricated reuse claim. Release 2 extends this with
   * AI-evaluated reuse decisions.
   */
  function deriveMethodologyReuseItems(test) {
    var reuse = normalizeMethodologyReuse(test);
    if (!reuse.kind) {
      return [];
    }
    var items = [];
    if (reuse.methodologyInherited) {
      items.push({ title: 'Methodology inherited', tone: TONES.INFO });
    }
    if (reuse.source) {
      items.push({ title: (reuse.kind === 'framework' ? 'Source framework: ' : 'Source engagement: ') + reuse.source, tone: TONES.INFO });
    }
    if (reuse.evidenceReviewed) {
      items.push({ title: 'Evidence reuse reviewed', tone: TONES.INFO });
    }
    return items;
  }

  /**
   * The approval reflection for a test — the recorded reviewer and outcome as a
   * single current-state entry (a real, current fact, not a fabricated past).
   * Empty only when the test carries neither a reviewer nor a status, in which
   * case the reserved placeholder renders.
   */
  function deriveApprovalHistory(test) {
    var source = test || {};
    if (source.reviewedBy) {
      return [{
        title: source.result ? ('Result reviewed: ' + source.result) : 'Reviewed',
        description: 'Reviewer ' + source.reviewedBy,
        tone: resolveResultTone(source.result) || resolveStatusTone(source.status)
      }];
    }
    if (source.status) {
      return [{ title: source.status, description: '', tone: resolveStatusTone(source.status) }];
    }
    return [];
  }

  /**
   * The Test Inspector configuration for one test (Master → Detail detail pane).
   * Renders the test procedure, related control, objective, testing method,
   * sample selection, evidence used, testing notes, result, reviewer, metadata,
   * methodology reuse, activity, and the approval reflection — a placeholder row
   * wherever the JSON lacks data, and never a fabricated conclusion. Pure and
   * host-agnostic: data in, one plain configuration out.
   */
  function buildTestInspector(test, context) {
    var item = test || {};
    var ctx = context || {};
    var ids = ctx.workspaceRegistry ? ctx.workspaceRegistry.IDS : {};
    // Issue #31 — Cross-Workspace Record Navigation: the related control and
    // raised finding are read through the shared relationship engine
    // (Issue #30's `getTestingGraph`) rather than re-deriving the same joins
    // locally, so this Inspector's cross-workspace links come from the one
    // place they are computed.
    var graph = RE.getTestingGraph(item, ctx);
    var related = graph.control;
    var evidence = deriveEvidenceStatus(item);
    var finding = graph.finding;
    var reuseItems = deriveMethodologyReuseItems(item);
    var controlHref = related && related.id ? WS.buildRecordHref(ctx.workspaceRegistry, ids.CONTROLS, related.id) : null;
    var findingHref = finding ? WS.buildRecordHref(ctx.workspaceRegistry, ids.FINDINGS, finding.id) : null;

    return {
      eyebrow: relatedControlLabel(related) || 'Test procedure',
      title: item.procedure || item.id || '',
      subtitle: [item.id, item.status].filter(Boolean).join(' · '),
      badges: [
        item.status ? { label: item.status, tone: resolveStatusTone(item.status) } : null,
        item.result ? { label: item.result, tone: resolveResultTone(item.result) } : null,
        { label: evidence.label, tone: evidence.tone }
      ].filter(Boolean),
      sections: [
        {
          title: 'Properties', kind: 'properties', columns: 2,
          rows: [
            { label: 'Test id', value: item.id || '' },
            { label: 'Related control', value: relatedControlLabel(related) },
            { label: 'Testing method', value: item.procedure || '' },
            { label: 'Status', value: item.status || '' },
            { label: 'Result', value: item.result || '' },
            { label: 'Tested by', value: item.testedBy || '' },
            { label: 'Reviewer', value: item.reviewedBy || '' },
            { label: 'Sample', value: item.sampleId || '' },
            { label: 'Sample set', value: item.sampleSetId || '' },
            { label: 'Working paper', value: item.workingPaperId || '' },
            { label: 'Framework', value: item.framework || '' },
            { label: 'Annex A section', value: item.annexASection || '' },
            { label: 'Finding', value: item.findingId || '' },
            { label: 'Expected result', value: item.expectedResult || '' },
            { label: 'Actual result', value: item.actualResult || '' }
          ].filter(function (row) { return row.value; })
        },
        listSection('Related control',
          related && related.id ? [{ title: relatedControlLabel(related), tone: TONES.INFO, actions: controlHref ? [{ label: 'Open', href: controlHref }] : [] }] : [],
          'No related control recorded for this test.'),
        textSection('Test procedure', item.procedure, 'No test procedure recorded. Release 2 adds AI-drafted test procedures.'),
        textSection('Objective', item.objective, 'No objective recorded for this test. Release 2 adds AI-refined test objectives.'),
        listSection('Sample selection',
          [
            item.sampleId ? { title: 'Sample: ' + item.sampleId, tone: TONES.INFO } : null,
            item.sampleSetId ? { title: 'Sample set: ' + item.sampleSetId, tone: TONES.INFO } : null
          ].filter(Boolean),
          'No sample recorded for this test. Release 2 adds AI-recommended sample selections.'),
        listSection('Evidence used',
          item.workingPaperId ? [{ title: 'Working paper: ' + item.workingPaperId, tone: TONES.INFO }] : [],
          'No evidence recorded yet — this test is still outstanding.'),
        textSection('Testing notes', item.notes, 'No testing notes recorded for this test.'),
        finding
          ? {
            title: 'Exception', kind: 'list',
            items: [{
              title: finding.title || 'Exception identified',
              description: [finding.severity, finding.status].filter(Boolean).join(' · '),
              tone: TONES.ERROR,
              actions: findingHref ? [{ label: 'Open', href: findingHref }] : []
            }]
          }
          : listSection('Exception', [], 'No exception raised for this test.'),
        reuseItems.length > 0
          ? { title: 'Methodology reuse', kind: 'list', items: reuseItems }
          : {
            title: 'Methodology reuse', kind: 'placeholder',
            empty: {
              icon: '◇', title: 'No methodology reuse recorded',
              description: 'Release 1 renders reuse only when the JSON records it. Release 2 adds AI-evaluated methodology and evidence reuse decisions here.'
            }
          },
        {
          title: 'Activity', kind: 'placeholder',
          empty: {
            icon: '◇', title: 'No activity recorded',
            description: 'Release 1 renders a test activity trail only when the JSON records one. Release 2 adds AI-assisted testing activity here.'
          }
        },
        listSection('Approval history', deriveApprovalHistory(item), 'No review recorded yet for this test.')
      ]
    };
  }

  // ------------------------------------------------------------------
  // View model — the single place this workspace reads AuditOS.state.
  // ------------------------------------------------------------------

  /** Reads the first dataset document an engagement owns in a collection, or null. */
  var readEngagementDocument = WS.readEngagementDocument;

  /** Finds a record by id within a list. */
  var findById = WS.findById;

  /** Indexes a list of records by their id field. */
  var indexById = WS.indexById;

  /**
   * Collects everything the Testing Workspace presents from the Shared Audit
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

    var companies = state.listRecords('companies');
    var company = findById(companies, engagement.companyId);
    var libraryControlsById = indexById(state.listRecords('control-library'));

    var testingDocument = readEngagementDocument(state, 'testing', engagement.id) || {};
    var controlsDocument = readEngagementDocument(state, 'controls', engagement.id) || {};
    var requirementsDocument = readEngagementDocument(state, 'evidence-requirements', engagement.id) || {};
    var evidenceDocument = readEngagementDocument(state, 'evidence', engagement.id) || {};
    var findingsDocument = readEngagementDocument(state, 'findings', engagement.id) || {};
    var reportsDocument = readEngagementDocument(state, 'reports', engagement.id) || {};
    var walkthroughDocument = readEngagementDocument(state, 'walkthroughs', engagement.id) || {};
    var suggestionsDocument = readEngagementDocument(state, 'suggestions', engagement.id) || {};
    // Single source of truth for the report's lifecycle position (Issue #42
    // documentation-validation fix) — see workspace-shared.js's own comment.
    WS.resolveReportStatus(engagement.id, reportsDocument);

    var testRecords = asArray(testingDocument.tests);
    var controlRecords = asArray(controlsDocument.controls);
    var controlsById = indexById(controlRecords);
    var findingsById = indexById(findingsDocument.findings);

    var frameworks = normalizeFrameworks(engagement);
    var auditPeriodLabel = formatPeriod(engagement.auditPeriod);

    var context = {
      controlsById: controlsById,
      libraryControlsById: libraryControlsById,
      findingsById: findingsById,
      // The joins the generated workpaper reads: requirements and evidence for
      // the evidence-reference register (§7), walkthrough sessions for the
      // walkthrough summary and its provenance (§4), points of contact and
      // users for owner and sign-off names, and the in-flight suggestions the
      // review workflow renders (§5).
      requirementsById: indexById(requirementsDocument.requirements),
      evidenceById: indexById(evidenceDocument.evidence),
      pocsById: indexById(state.listRecords('pocs')),
      usersById: indexById(state.listRecords('users')),
      walkthroughSessions: asArray(walkthroughDocument.sessions),
      suggestions: asArray(suggestionsDocument.suggestions),
      workspaceRegistry: workspaceRegistry,
      frameworks: frameworks,
      auditPeriodLabel: auditPeriodLabel,
      engagement: engagement,
      company: company
    };

    // Engagement-level review context the right pane renders beneath the
    // record-level review. Attached to the context so the pane builders stay
    // pure functions of `(row, context)` and never reach back into the
    // view model.
    context.exceptions = deriveExceptions(testRecords, context);
    context.activity = deriveActivity(testRecords);

    var operational = {
      requirements: { requirements: asArray(requirementsDocument.requirements).length },
      controls: { controls: controlRecords.length },
      evidence: evidenceDocument.summary || {},
      testing: { tests: testRecords.length },
      findings: findingsDocument.summary || {},
      report: reportsDocument.document || null
    };

    var queue = deriveQueue(testRecords, context);
    var testingStatus = deriveTestingStatus(testRecords);
    var progress = deriveTestingProgress(testRecords);
    var metadata = deriveMetadata(testingDocument.metadata, engagement, company, testRecords);

    return {
      degraded: false,
      status: status,
      engagement: engagement,
      company: company,
      frameworks: frameworks,
      context: context,

      header: {
        eyebrow: engagement.engagementCode + ' · Testing',
        title: company ? company.name : engagement.companyId,
        meta: engagement.name + ' · assurance testing',
        frameworks: frameworks,
        status: testingStatus,
        lastUpdated: testingDocument.metadata && testingDocument.metadata.generatedAt
          ? 'Updated ' + formatDate(String(testingDocument.metadata.generatedAt).slice(0, 10))
          : '',
        actions: [{ label: 'Engagement overview', href: '#/engagements', variant: 'subtle' }]
      },

      ribbon: [
        { label: 'Client', value: company ? company.name : engagement.companyId },
        { label: 'Audit period', value: auditPeriodLabel },
        { label: 'Tests', value: String(testRecords.length) }
      ],

      testingHealth: deriveTestingHealth(testRecords),
      progress: progress,
      queue: queue,
      views: deriveViews(queue),
      // The workpaper selector: one row per control, carrying the workpaper
      // recorded against it (Issue #40 §3).
      workpapers: deriveWorkpaperRows(controlRecords, testRecords),
      exceptions: context.exceptions,
      lineage: deriveLineage(workspaceRegistry, operational),
      activity: context.activity,
      metadata: metadata,

      // The workspace status strip. Collection metadata reads here rather than
      // in a panel of its own: the viewport shell gives its whole canvas to the
      // workpaper (Issue #40 §12).
      footer: [
        { label: 'Environment', value: 'Static prototype' },
        { label: 'Demo status', value: status.demoDataLoaded ? 'Demo data loaded' : 'Demo data degraded' },
        { label: 'Version', value: metadata.version },
        { label: 'Source', value: metadata.source },
        { label: 'Modified', value: metadata.modified }
      ].filter(function (entry) { return entry.value; })
    };
  }

  // ------------------------------------------------------------------
  // Generic DOM builders — thin layout wrappers around the Enterprise Data
  // Presentation System (AuditOS.presentation). Text is always assigned through
  // textContent, never markup injection.
  // ------------------------------------------------------------------

  /** Creates an element with a class and optional text content. */
  var el = WS.el;

  /** The shared presentation system, resolved at render time. */
  var presentation = WS.presentation;

  /**
   * Builds the Testing Health strip: a row of tone-dot indicators (editor
   * status-bar style, identical composition to the other operational workspaces).
   * The status text carries the meaning; the dot only reinforces the tone, so
   * health reads without relying on color.
   */
  function buildHealthStrip(items) {
    return WS.buildHealthStrip('aos-testing', 'Testing health', items);
  }

  /**
   * Builds the Testing Progress body: the shared Progress meter over real counts
   * (completed of total), with a breakdown line of the passed / exception /
   * pending figures. No estimated percentage — the ratio is a real measurement.
   */
  function buildProgressBody(progress) {
    var P = presentation();
    var wrap = el('div', 'aos-testing__progress');
    wrap.appendChild(P.progressMeter({
      label: 'Tests completed', value: progress.completed, total: progress.total, tone: TONES.INFO
    }));
    var breakdown = el('div', 'aos-testing__progress-breakdown');
    [
      { label: 'Passed', value: progress.passed },
      { label: 'Exceptions', value: progress.failed },
      { label: 'Pending', value: progress.pending }
    ].forEach(function (entry) {
      var item = el('span', 'aos-testing__progress-item');
      item.appendChild(el('span', 'aos-testing__progress-item-label', entry.label));
      item.appendChild(el('span', 'aos-testing__progress-item-value aos-numeric', String(entry.value)));
      breakdown.appendChild(item);
    });
    wrap.appendChild(breakdown);
    return wrap;
  }

  /** Builds one Test Procedure Queue master row: procedure + test id, status, and operational meta. */
  function buildRow(row) {
    var P = presentation();
    var node = el('button', null);
    node.type = 'button';

    var head = el('div', 'aos-testing__row-head');
    var identity = el('div', 'aos-testing__row-identity');
    if (row.id) {
      identity.appendChild(el('span', 'aos-testing__row-code aos-numeric', row.id));
    }
    identity.appendChild(el('span', 'aos-testing__row-title', row.procedure || row.id));
    head.appendChild(identity);
    if (row.status) {
      head.appendChild(P.statusBadge({ label: row.status, tone: row.statusTone }));
    }
    node.appendChild(head);

    var meta = el('div', 'aos-testing__row-meta');
    if (row.controlLabel) {
      meta.appendChild(el('span', 'aos-testing__row-control', row.controlLabel));
    }
    if (row.testedBy) {
      meta.appendChild(el('span', null, row.testedBy));
    }
    if (row.result) {
      meta.appendChild(el('span', 'aos-testing__row-result aos-testing__row-result--' + (row.resultTone || 'neutral'), row.result));
    }
    if (row.evidence && row.evidence.label) {
      meta.appendChild(el('span', 'aos-testing__row-coverage', row.evidence.label));
    }
    node.appendChild(meta);
    return node;
  }

  /**
   * Renders a set of grouped rows into a master list node and wires selection to
   * the detail mount. Clears the list first, so the same node re-renders when the
   * presentation view changes — the mechanism behind the three views over one
   * dataset. Group labels render as a labeled divider carrying the group's count.
   */
  function mountRailGroups(listNode, detailMount, groups, context, targetId) {
    WS.mountRailGroups('aos-testing', listNode, detailMount, groups, context, buildRow, buildTestInspector, 'test', targetId);
  }

  /**
   * Builds the Test Procedure Queue: a view switcher above a Master–Detail whose
   * master rail lists the tests for the active view and whose detail shows the
   * selected test's Inspector Panel. The switcher swaps between the three
   * presentation modes — Test view, By control, By result — by re-rendering the
   * same rail from the same dataset (presentation-only, memory-only); it never
   * changes the data.
   */
  function buildQueueBody(views, context, targetId) {
    var wrap = el('div', 'aos-testing__queue');
    var detailMount = el('div', 'aos-testing__detail-mount');
    var listNode = el('div', 'aos-testing__row-list');
    listNode.setAttribute('role', 'list');

    var switcher = el('div', 'aos-testing__views');
    switcher.setAttribute('role', 'group');
    switcher.setAttribute('aria-label', 'Test views');
    var chips = [];

    function activate(index) {
      chips.forEach(function (chip, chipIndex) {
        var selected = chipIndex === index;
        chip.classList.toggle('aos-testing__view-chip--active', selected);
        chip.setAttribute('aria-pressed', selected ? 'true' : 'false');
      });
      mountRailGroups(listNode, detailMount, views[index].view.groups, context, targetId);
    }

    asArray(views).forEach(function (view, index) {
      var chip = el('button', 'aos-testing__view-chip', view.label);
      chip.type = 'button';
      chip.setAttribute('aria-pressed', index === 0 ? 'true' : 'false');
      if (index === 0) {
        chip.classList.add('aos-testing__view-chip--active');
      }
      chip.addEventListener('click', function () { activate(index); });
      chips.push(chip);
      switcher.appendChild(chip);
    });

    var masterDetail = presentation().masterDetail({
      list: listNode, detail: detailMount, ratio: 42,
      listLabel: 'Test procedure queue', detailLabel: 'Test inspector'
    });

    wrap.appendChild(switcher);
    wrap.appendChild(masterDetail);
    activate(0);
    return wrap;
  }

  /**
   * Builds the Exceptions body: the shared Item List of the tests whose result is
   * Fail, each linking to its raised finding. Never renders a placeholder finding;
   * an engagement with no exceptions renders the shared Empty State.
   */
  function buildExceptionsBody(exceptions) {
    var P = presentation();
    if (asArray(exceptions).length === 0) {
      return P.emptyState({
        icon: '✓', title: 'No exceptions',
        description: 'No test has recorded an exception for this engagement. Actual exceptions appear here as testing surfaces them — never a placeholder finding.'
      });
    }
    return P.itemList(exceptions.map(function (item) {
      return {
        title: item.title,
        description: [item.control, item.severity].filter(Boolean).join(' · '),
        meta: item.findingId,
        tone: item.tone,
        critical: true
      };
    }));
  }

  /**
   * Builds the Audit Lineage body: the methodology chain rendered as connected
   * nodes with Testing highlighted. Each node shows its real count and links into
   * its workspace; absent nodes read "—". The chain reads left-to-right on wide
   * canvases and stacks on narrow ones (stylesheet).
   */
  function buildLineageBody(lineage) {
    return WS.buildLineageBody('aos-testing', lineage);
  }

  /** Builds the Activity Feed for the activity supporting panel. */
  function buildActivityBody(activity) {
    return WS.buildActivityBody(activity, {
      icon: '◇', title: 'No recent activity',
      description: 'Test executions, reviews, and conclusions appear here as the engagement progresses.'
    });
  }

  /** Builds a run of labeled value items for the workspace footer. */
  function buildFooterItems(entries) {
    return WS.buildFooterItems('aos-testing', entries);
  }

  /**
   * Host-agnostic Inspector renderer (§9): given the test queue and the
   * resolution context, returns one self-contained Master–Detail node — the test
   * rail beside the Test Inspector — making no assumption about where it is
   * mounted. Release 1 mounts the fuller Queue (with its view switcher) in the
   * primary content; this renderer exposes the same master → detail interaction
   * for any other host with no change here.
   */
  function renderInspector(queue, context) {
    var detailMount = el('div', 'aos-testing__detail-mount');
    var listNode = el('div', 'aos-testing__row-list');
    listNode.setAttribute('role', 'list');
    mountRailGroups(listNode, detailMount, [{ label: '', rows: queue }], context);
    return presentation().masterDetail({
      list: listNode, detail: detailMount, ratio: 42,
      listLabel: 'Test procedure queue', detailLabel: 'Test inspector'
    });
  }

  // ------------------------------------------------------------------
  // Generated workpaper (Issue #40 §3 / §4 / §5) — the middle and right panes.
  // The worksheet model comes from the canonical Workpaper Service; nothing
  // here re-derives an audit fact. Presentation state is memory-only: which
  // control is selected, the rail query, and which sections are open for edit.
  // ------------------------------------------------------------------

  var boardState = { controlId: '', search: '', editing: {}, lastTargetId: '' };

  /** Builds one titled pane block: a fixed structural heading above its body. */
  function paneBlock(title, body) {
    var block = el('section', 'aos-testing__block');
    block.appendChild(el('h3', 'aos-testing__block-title', title));
    block.appendChild(body);
    return block;
  }

  /**
   * The plain-text representation of a section — what the reviewer sees when
   * they open it for editing, and what a proposed change is measured against.
   * Structured sections flatten to `label: value` lines so a reviewer edits the
   * same content they were reading, never a different encoding of it.
   */
  function sectionText(section) {
    if (!section || !section.present) {
      return '';
    }
    switch (section.kind) {
      case 'text':
        return section.text;
      case 'narrative':
        return [section.text].concat(asArray(section.items).map(function (item) {
          return [item.title, item.description].filter(Boolean).join(' — ');
        })).filter(Boolean).join('\n');
      case 'properties':
        return asArray(section.rows).map(function (row) {
          return row.label + ': ' + row.value;
        }).join('\n');
      case 'attributes':
        return asArray(section.rows).map(function (row) {
          return [row.key, row.text, row.result].filter(Boolean).join(' | ');
        }).join('\n');
      case 'evidence':
        return asArray(section.rows).map(function (row) {
          return [row.id, row.title, row.evidenceType, row.status, row.owner].filter(Boolean).join(' | ');
        }).join('\n');
      case 'list':
        return asArray(section.items).map(function (item) {
          return [item.title, item.description].filter(Boolean).join(' — ');
        }).join('\n');
      case 'conclusion':
        return asArray(section.rows).map(function (row) {
          return row.label + ': ' + row.value;
        }).concat(section.text ? [section.text] : []).join('\n');
      default:
        return '';
    }
  }

  /** Builds the read-only body of one worksheet section, by kind. */
  function sectionBody(section, context) {
    var P = presentation();
    if (!section.present) {
      return P.emptyState(section.empty);
    }
    switch (section.kind) {
      case 'text':
        return el('p', 'aos-testing__worksheet-text', section.text);

      case 'narrative':
        var narrative = el('div', 'aos-testing__worksheet-narrative');
        if (section.text) {
          narrative.appendChild(el('p', 'aos-testing__worksheet-text', section.text));
        }
        if (asArray(section.items).length > 0) {
          narrative.appendChild(P.itemList(section.items, { compact: true }));
        }
        return narrative;

      case 'properties':
        return P.propertyGrid(section.rows, { columns: 2 });

      case 'conclusion':
        var conclusion = el('div', 'aos-testing__worksheet-narrative');
        if (asArray(section.rows).length > 0) {
          conclusion.appendChild(P.propertyGrid(section.rows, { columns: 2 }));
        }
        if (section.text) {
          conclusion.appendChild(el('p', 'aos-testing__worksheet-text', section.text));
        }
        return conclusion;

      case 'attributes':
        return P.dataGrid({
          density: 'compact',
          caption: 'Tested attributes',
          columns: [
            { key: 'key', label: 'Attribute', width: '7rem' },
            { key: 'text', label: 'Attribute details' },
            { key: 'result', label: 'Result', width: '8rem' }
          ],
          rows: section.rows.map(function (row) {
            return { cells: { key: row.key, text: row.text, result: row.result || '—' } };
          })
        });

      case 'evidence':
        return P.dataGrid({
          density: 'compact',
          caption: 'Evidence supporting this control',
          columns: [
            { key: 'id', label: 'Reference', width: '10rem' },
            { key: 'title', label: 'Evidence' },
            { key: 'type', label: 'Type', width: '10rem' },
            { key: 'status', label: 'Status', width: '10rem' },
            { key: 'phase', label: 'Lifecycle', width: '8rem' },
            { key: 'owner', label: 'Owner', width: '10rem' }
          ],
          rows: section.rows.map(function (row) {
            return { cells: buildEvidenceCells(row, context) };
          })
        });

      case 'list':
        return P.itemList(section.items, { compact: true });

      default:
        return P.emptyState(section.empty);
    }
  }

  /**
   * The cells of one evidence-reference row. The reference is a link into the
   * Evidence workspace — the canonical route carries the client and engagement,
   * so the context is preserved and the drawer opens on arrival (§9) — but only
   * where the evidence record genuinely resolves.
   */
  function buildEvidenceCells(row, context) {
    var registry = context.workspaceRegistry;
    var ids = registry ? registry.IDS : {};
    var href = row.resolved ? WS.buildRecordHref(registry, ids.EVIDENCE, row.id) : null;
    var reference = row.id;
    if (href) {
      var link = el('a', 'aos-testing__worksheet-link', row.id);
      link.setAttribute('href', href);
      reference = link;
    }
    return {
      id: reference,
      title: row.title,
      type: row.evidenceType,
      status: row.status,
      phase: row.phase,
      owner: row.owner
    };
  }

  /**
   * Builds one section's AI provenance (§4): an expand/collapse disclosure of
   * what the block was generated from — walkthrough sessions, evidence, control
   * metadata, AI rationale — with each source present only where the data backs
   * it. This is the one part of the worksheet that is never editable.
   */
  function buildProvenanceDisclosure(section) {
    var disclosure = el('details', 'aos-testing__provenance');
    var summary = el('summary', 'aos-testing__provenance-summary', 'Generated from');
    disclosure.appendChild(summary);
    var list = el('ul', 'aos-testing__provenance-list');
    asArray(section.provenance).forEach(function (entry) {
      var item = el('li', 'aos-testing__provenance-item' +
        (entry.present ? '' : ' aos-testing__provenance-item--absent'));
      item.appendChild(el('span', 'aos-testing__provenance-label', entry.label));
      if (entry.present) {
        entry.items.forEach(function (fact) {
          item.appendChild(el('span', 'aos-testing__provenance-fact',
            [fact.title, fact.detail].filter(Boolean).join(' — ')));
        });
      } else {
        item.appendChild(el('span', 'aos-testing__provenance-fact', 'Not recorded'));
      }
      list.appendChild(item);
    });
    disclosure.appendChild(list);
    return disclosure;
  }

  /**
   * Proposes a worksheet edit (§5 — Reviewer edits → AI Suggestion →
   * Approval). Production state is never edited directly: the proposal enters
   * the canonical Suggested → Reviewed → Approved → Applied lifecycle through
   * the shared Suggestion Lifecycle Service, which performs the audited write
   * and records who proposed what against which workpaper section.
   */
  function proposeSectionEdit(row, section, draft, context) {
    var suggestionService = AuditOS.suggestionService;
    var repository = AuditOS.repository;
    if (!suggestionService || !repository || !context.engagement) {
      return null;
    }
    return suggestionService.propose(repository, context.engagement.id, {
      title: 'Workpaper edit — ' + row.controlCode + ' · ' + section.title,
      description: draft,
      category: 'workpaper-section',
      affectedControls: [row.id],
      auditReferences: [row.workpaperId, section.id].filter(Boolean)
    });
  }

  /**
   * Builds one worksheet section: its heading, the recorded content, an Edit
   * affordance for everything except the provenance, and the provenance
   * disclosure. Opening Edit shows the section's current content in a textarea;
   * proposing the change enters the review workflow and never writes the record.
   */
  function buildWorksheetSection(section, row, context, onProposed) {
    var P = presentation();
    var node = el('section', 'aos-testing__worksheet-section');

    var head = el('div', 'aos-testing__worksheet-head');
    head.appendChild(el('h3', 'aos-testing__worksheet-title', section.title));
    var bodyMount = el('div', 'aos-testing__worksheet-body');

    function renderRead() {
      bodyMount.replaceChildren(sectionBody(section, context));
    }

    function renderEdit() {
      var editor = el('div', 'aos-testing__editor');
      var field = el('textarea', 'aos-testing__editor-field');
      field.value = sectionText(section);
      field.setAttribute('aria-label', 'Proposed ' + section.title.toLowerCase());
      field.rows = 6;
      editor.appendChild(field);

      var note = el('p', 'aos-testing__editor-note',
        'Proposing a change never edits the record. It enters the Suggested → Reviewed → Approved → Applied workflow; the workpaper is written only on Apply.');
      editor.appendChild(note);

      var actions = el('div', 'aos-action-group');
      actions.setAttribute('role', 'group');
      actions.setAttribute('aria-label', section.title + ' edit actions');

      var proposeButton = P.button({ label: 'Propose change', variant: 'primary' });
      proposeButton.addEventListener('click', function () {
        var draft = String(field.value || '').trim();
        if (!draft || draft === sectionText(section)) {
          return;
        }
        proposeSectionEdit(row, section, draft, context);
        boardState.editing[section.id] = false;
        if (typeof onProposed === 'function') {
          onProposed();
        }
      });
      actions.appendChild(proposeButton);

      var cancelButton = P.button({ label: 'Cancel', variant: 'subtle' });
      cancelButton.addEventListener('click', function () {
        boardState.editing[section.id] = false;
        toggle.textContent = 'Edit';
        toggle.setAttribute('aria-expanded', 'false');
        renderRead();
      });
      actions.appendChild(cancelButton);
      editor.appendChild(actions);
      bodyMount.replaceChildren(editor);
    }

    var toggle = el('button', 'aos-testing__worksheet-edit',
      boardState.editing[section.id] ? 'Editing' : 'Edit');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', boardState.editing[section.id] ? 'true' : 'false');
    toggle.setAttribute('aria-label', 'Edit ' + section.title);
    toggle.addEventListener('click', function () {
      var open = !boardState.editing[section.id];
      boardState.editing[section.id] = open;
      toggle.textContent = open ? 'Editing' : 'Edit';
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) {
        renderEdit();
      } else {
        renderRead();
      }
    });
    head.appendChild(toggle);
    node.appendChild(head);
    node.appendChild(bodyMount);

    if (boardState.editing[section.id]) {
      renderEdit();
    } else {
      renderRead();
    }

    node.appendChild(buildProvenanceDisclosure(section));
    return node;
  }

  /**
   * Builds the middle pane: the generated worksheet for the selected control
   * (§3). Selecting another control regenerates it from the canonical model —
   * there is no cached worksheet and no second definition of its structure.
   */
  function buildWorksheetCanvas(row, context, onProposed) {
    var P = presentation();
    var service = workpapers();
    var canvas = el('div', 'aos-testing__worksheet');
    if (!row || !service) {
      canvas.appendChild(P.emptyState({
        icon: '◇', title: 'No control selected',
        description: 'Select a control to generate its audit workpaper here.'
      }));
      return canvas;
    }

    var model = service.buildWorkpaper(row.control, row.test, context);

    var head = el('header', 'aos-testing__worksheet-header');
    var identity = el('div', 'aos-testing__worksheet-identity');
    identity.appendChild(el('p', 'aos-testing__worksheet-eyebrow',
      [model.controlCode, model.workpaperId].filter(Boolean).join(' · ')));
    identity.appendChild(el('h2', 'aos-testing__worksheet-heading', model.title || model.controlId));
    head.appendChild(identity);

    var badges = el('div', 'aos-testing__worksheet-badges');
    if (model.status.label) {
      badges.appendChild(P.statusBadge({ label: model.status.label, tone: model.status.tone }));
    }
    if (model.status.phase) {
      badges.appendChild(P.statusBadge({ label: model.status.phase, tone: null }));
    }
    if (!model.generated) {
      badges.appendChild(P.statusBadge({ label: 'Not started', tone: TONES.WARNING }));
    }
    head.appendChild(badges);

    // §6 — the workpaper leaves the application in both formats the issue asks
    // for, serialized from this same model by the canonical export service.
    var exportService = workpaperExport();
    if (exportService) {
      var actions = el('div', 'aos-action-group');
      actions.setAttribute('role', 'group');
      actions.setAttribute('aria-label', 'Workpaper export');
      var htmlButton = P.button({ label: 'Download HTML workpaper', variant: 'subtle' });
      htmlButton.addEventListener('click', function () {
        exportService.downloadHtml(model, {
          clientName: context.company ? context.company.name : '',
          engagementName: context.engagement ? context.engagement.name : ''
        });
      });
      actions.appendChild(htmlButton);
      var excelButton = P.button({ label: 'Download Excel', variant: 'primary' });
      excelButton.addEventListener('click', function () {
        exportService.downloadExcel(model);
      });
      actions.appendChild(excelButton);
      head.appendChild(actions);
    }
    canvas.appendChild(head);

    model.sections.forEach(function (section) {
      canvas.appendChild(buildWorksheetSection(section, row, context, onProposed));
    });
    return canvas;
  }

  /**
   * Builds the right pane: review, AI, and provenance (§3 — Right Panel). The
   * review workflow is the canonical Suggestion lifecycle rendered by the
   * shared workflow card; the provenance is the canonical AI lineage. Neither
   * is re-implemented here (§10).
   */
  function buildReviewPane(row, context) {
    var P = presentation();
    var service = workpapers();
    var pane = el('div', 'aos-testing__review');
    if (!row || !service) {
      pane.appendChild(P.emptyState({
        icon: '◇', title: 'Nothing selected',
        description: 'The review state of the selected workpaper appears here.'
      }));
      return pane;
    }

    var model = service.buildWorkpaper(row.control, row.test, context);

    var statusRows = [
      { label: 'Workpaper', value: model.workpaperId || 'Not generated' },
      { label: 'Status', value: model.status.label || 'Not recorded' },
      { label: 'Lifecycle phase', value: model.status.phase || 'Not recorded' },
      { label: 'Result', value: row.result || 'Not recorded' }
    ];
    pane.appendChild(paneBlock('Workpaper status', P.propertyGrid(statusRows, { columns: 1 })));

    var suggestions = deriveWorkpaperSuggestions(row, context.suggestions).filter(function (suggestion) {
      return suggestion.status !== 'Applied' && suggestion.status !== 'Rejected';
    });
    var workflow = el('div', 'aos-testing__workflow');
    if (suggestions.length === 0) {
      workflow.appendChild(el('p', 'aos-testing__workflow-note',
        'No change in flight. A proposed worksheet edit enters the Suggested → Reviewed → Approved → Applied workflow; the workpaper is written only on Apply. Release 2 propagates an applied change back through walkthrough, evidence, and controls.'));
    }
    var engagementId = context.engagement ? context.engagement.id : '';
    suggestions.forEach(function (suggestion) {
      workflow.appendChild(WS.buildSuggestionWorkflowCard(suggestion, engagementId, resolveStatusTone));
    });
    pane.appendChild(paneBlock('Review workflow', workflow));

    var ai = P.emptyState({
      icon: '✦', title: 'Reserved for AI advisory',
      description: 'AI-assisted testing — drafted procedures, recommended sample selections, identified testing gaps, evaluated evidence, and proposed conclusions — appears here once the AI foundation is implemented. AI remains advisory; human approval remains mandatory.'
    });
    ai.classList.add('aos-tint-brand');
    pane.appendChild(paneBlock('AI recommendations', ai));

    pane.appendChild(paneBlock('AI lineage', buildLineageStages(model)));

    // Engagement-level review context beneath the record-level review: the
    // exceptions testing has actually surfaced across the engagement, and the
    // dated testing activity it has recorded. Both are clearly scoped to the
    // engagement, not to the selected workpaper.
    pane.appendChild(paneBlock('Engagement exceptions',
      buildExceptionsBody(asArray(context.exceptions))));
    pane.appendChild(paneBlock('Recent testing activity',
      buildActivityBody(asArray(context.activity))));
    return pane;
  }

  /**
   * Builds the object-level AI lineage from the canonical service (§10): the
   * nine ordered stages, rendered only from recorded facts. A workpaper with no
   * declared AI origin says so plainly rather than implying one.
   */
  function buildLineageStages(model) {
    var wrap = el('div', 'aos-testing__lineage-stages-wrap');
    if (!model.lineage) {
      return wrap;
    }
    if (!model.isAiGenerated) {
      wrap.appendChild(el('p', 'aos-testing__lineage-note',
        'This workpaper declares no AI origin — it was prepared directly. An AI-generated workpaper carries its complete lineage here: origin, walkthrough session, transcript, evidence references, reasoning, generation, review, and approval.'));
    }
    var list = el('ol', 'aos-testing__lineage-stages');
    model.lineage.stages.forEach(function (stage) {
      var item = el('li', 'aos-testing__lineage-stage' +
        (stage.present ? '' : ' aos-testing__lineage-stage--absent'));
      item.appendChild(el('span', 'aos-testing__lineage-stage-label', stage.label));
      if (stage.present) {
        stage.items.forEach(function (fact) {
          item.appendChild(el('span', 'aos-testing__lineage-stage-item',
            [fact.title, fact.detail].filter(Boolean).join(' · ')));
        });
      } else {
        item.appendChild(el('span', 'aos-testing__lineage-stage-item', '—'));
      }
      list.appendChild(item);
    });
    wrap.appendChild(list);
    return wrap;
  }

  /** Builds one control-selector row: control code + title, status, and result. */
  function buildSelectorRow(row) {
    var P = presentation();
    var node = el('button', null);
    node.type = 'button';

    var head = el('div', 'aos-testing__row-head');
    var identity = el('div', 'aos-testing__row-identity');
    identity.appendChild(el('span', 'aos-testing__row-code aos-numeric', row.controlCode));
    identity.appendChild(el('span', 'aos-testing__row-title', row.title));
    // The rail truncates to keep rows to two lines; the full title stays
    // available on hover and to assistive technology, and in full in the
    // generated worksheet. Nothing is hidden.
    node.setAttribute('title', [row.controlCode, row.title].filter(Boolean).join(' — '));
    head.appendChild(identity);
    if (row.status) {
      head.appendChild(P.statusBadge({ label: row.status, tone: row.statusTone }));
    }
    node.appendChild(head);

    var meta = el('div', 'aos-testing__row-meta');
    if (row.family) {
      meta.appendChild(el('span', null, row.family));
    }
    if (row.result) {
      meta.appendChild(el('span', 'aos-testing__row-result aos-testing__row-result--' + (row.resultTone || 'neutral'), row.result));
    }
    meta.appendChild(el('span', 'aos-testing__row-coverage', row.generated ? 'Workpaper generated' : 'No workpaper'));
    node.appendChild(meta);
    return node;
  }

  /**
   * Builds the left pane: the control selector (§3 — Left Panel). The search
   * input is built once and never rebuilt, so typing never loses focus; only
   * the list is re-rendered, and selecting a control replaces only the two
   * right-hand panes, so the rail's scroll position survives.
   */
  function buildSelectorRail(viewModel, targetId, onSelect) {
    var P = presentation();
    var context = viewModel.context;
    var rail = el('div', 'aos-testing__rail');

    var searchLabel = el('label', 'aos-testing__search');
    searchLabel.appendChild(el('span', 'aos-testing__search-label', 'Search controls'));
    var searchInput = el('input', 'aos-testing__search-input');
    searchInput.type = 'search';
    searchInput.value = boardState.search;
    searchInput.setAttribute('placeholder', 'Code, title, family, or status');
    searchInput.setAttribute('aria-label', 'Search controls');
    searchLabel.appendChild(searchInput);
    rail.appendChild(searchLabel);

    var countLabel = el('p', 'aos-testing__rail-count');
    var listNode = el('div', 'aos-testing__row-list');
    listNode.setAttribute('role', 'list');

    function render(preferredId) {
      var rows = viewModel.workpapers.filter(function (row) {
        return matchesSearch(row, boardState.search);
      });
      countLabel.textContent = rows.length === viewModel.workpapers.length
        ? rows.length + ' controls'
        : rows.length + ' of ' + viewModel.workpapers.length + ' controls';
      if (rows.length === 0) {
        listNode.replaceChildren(P.emptyState({
          icon: '◇', title: 'No control matches the search',
          description: 'Clear or change the query to see more of the engagement’s controls.'
        }));
        onSelect(null);
        return;
      }
      WS.mountRailGroups('aos-testing', listNode, null, [{ label: '', rows: rows }], context,
        buildSelectorRow, null, null, preferredId, onSelect);
    }

    rail.appendChild(countLabel);
    rail.appendChild(listNode);

    searchInput.addEventListener('input', function () {
      boardState.search = searchInput.value;
      render(boardState.controlId);
    });

    render(targetId || boardState.controlId);
    return rail;
  }

  // ------------------------------------------------------------------
  // Slot rendering
  // ------------------------------------------------------------------

  /** Replaces a slot's content with the given nodes (or clears it). */
  var fillSlot = WS.fillSlot;

  /**
   * Hides the framework's supporting-panel band for this workspace: the
   * Workbench's own right pane IS the supporting information, so the band below
   * would duplicate it and push the application below the fold (§3 / §12).
   */
  function collapseSupportingRegions(view) {
    var panels = view.querySelector('[data-region="supporting-panels"]');
    if (panels) {
      panels.hidden = true;
    }
  }

  /**
   * Renders the ready testing experience: the fixed-frame viewport shell
   * hosting one Workbench — control selector, generated worksheet, review pane
   * — with the engagement-level testing health, progress, and audit chain in
   * the compact context band above it.
   */
  /**
   * Asks the Testing Agent to draft the selected workpaper's test procedure.
   *
   * Fired on selection rather than on render, and for the selected workpaper
   * alone. The engagement has 121 workpapers recording no procedure; drafting
   * all of them on load would spend a request on each and put 121 cards in
   * front of a reviewer at once, which is how an approval gate stops being
   * read. One card, for the record the auditor is actually looking at.
   *
   * The agent declines by itself when there is nothing to do — no AI backend, a
   * procedure already recorded, no linked control, or a draft already awaiting
   * a decision — so this stays a single unconditional call. A filed draft
   * republishes and re-renders through the ordinary state subscription and
   * appears in the review pane awaiting a decision; nothing reaches the
   * workpaper until a human approves it.
   */
  function requestProcedureDraft(viewModel, row) {
    var agent = AuditOS.testingAgent;
    if (!agent || !row || !row.test || !viewModel || !viewModel.engagement) {
      return;
    }
    agent.requestDraft({
      engagementId: viewModel.engagement.id,
      test: row.test,
      control: row.control
    });
  }

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

    var canvas = el('div', 'aos-testing');
    canvas.setAttribute('data-canvas', 'flush');

    // The compact context band: engagement-level testing health, progress, and
    // the audit chain. Each is a single row, so the operational panes below
    // keep the viewport (§12 — the chrome never crowds the task).
    var band = el('div', 'aos-testing__band');
    var health = buildHealthStrip(viewModel.testingHealth);
    health.classList.add('aos-testing__health');
    band.appendChild(health);
    if (viewModel.progress.total > 0) {
      band.appendChild(buildProgressBody(viewModel.progress));
    }
    if (viewModel.lineage.length > 0) {
      band.appendChild(buildLineageBody(viewModel.lineage));
    }
    canvas.appendChild(band);

    var canvasMount = el('div', 'aos-testing__canvas-mount');
    var reviewMount = el('div', 'aos-testing__review-mount');
    var selectedRow = null;

    function renderPanes() {
      canvasMount.replaceChildren(buildWorksheetCanvas(selectedRow, viewModel.context, renderPanes));
      reviewMount.replaceChildren(buildReviewPane(selectedRow, viewModel.context));
    }

    function selectWorkpaper(row) {
      selectedRow = row;
      boardState.controlId = row && row.id ? row.id : '';
      // A different control means a different worksheet: reset which sections
      // are open for edit so an edit box never carries across records.
      boardState.editing = {};
      renderPanes();
      requestProcedureDraft(viewModel, row);
    }

    // The route may name either a control or a workpaper record; both resolve
    // to the same selector row, so a deep link from Controls and one from a
    // findings/test reference both land on the right worksheet.
    var routedRow = targetId
      ? viewModel.workpapers.filter(function (row) {
        return row.id === targetId || row.workpaperId === targetId;
      })[0] || null
      : null;
    var preferredId = (routedRow && targetId !== boardState.lastTargetId)
      ? routedRow.id : boardState.controlId;
    boardState.lastTargetId = targetId;

    var workbench = P.workbench({
      rail: viewModel.workpapers.length > 0
        ? buildSelectorRail(viewModel, preferredId, selectWorkpaper)
        : P.emptyState({
          icon: '◇', title: 'No controls yet',
          description: 'The generated workpaper is built per control. Controls appear here as they are drafted for the engagement.'
        }),
      canvas: canvasMount,
      inspector: reviewMount,
      railRatio: 22,
      inspectorRatio: 26,
      railLabel: 'Control selector',
      canvasLabel: 'Generated workpaper',
      inspectorLabel: 'Review, AI, and provenance'
    });
    workbench.classList.add('aos-rise-in');
    canvas.appendChild(workbench);

    if (viewModel.workpapers.length === 0) {
      selectWorkpaper(null);
    }

    fillSlot(view, SLOTS.CONTENT, [canvas]);
    fillSlot(view, SLOTS.FOOTER, [buildFooterItems(viewModel.footer)]);
  }

  /** Renders the layout-stable loading state (§15.12 — Loading). */
  function renderLoading(view) {
    var P = presentation();
    collapseSupportingRegions(view);
    fillSlot(view, SLOTS.CONTENT, [P.loadingState({ variant: 'detail', label: 'Loading testing' })]);
  }

  /** Renders the degraded state (§15.12 — Empty / Error). */
  function renderDegraded(view, viewModel) {
    var P = presentation();
    collapseSupportingRegions(view);
    fillSlot(view, SLOTS.CONTENT, [P.emptyState({
      icon: '◇', title: 'No engagement available',
      description: 'The Shared Audit State holds no engagement to present' +
        (viewModel.status && viewModel.status.degradedReason ? ' (' + viewModel.status.degradedReason + ')' : '') +
        '. Regenerate the demo-data bundle and reload to restore the Testing Workspace.'
    })]);
  }

  // ------------------------------------------------------------------
  // Wiring — follows the router and the Shared Audit State.
  // ------------------------------------------------------------------

  /**
   * Renders the Testing Workspace when it is the active workspace: the ready
   * experience once the state has loaded, the loading skeleton before that, and
   * the degraded explanation when no engagement is available.
   */
  function renderActiveTesting() {
    var registry = AuditOS.workspaceRegistry;
    var router = AuditOS.router;
    var state = AuditOS.state;
    if (!registry || !router || !AuditOS.workspaceFramework || !AuditOS.presentation) {
      return;
    }
    if (router.getCurrentWorkspaceId() !== registry.IDS.TESTING) {
      return;
    }

    var view = global.document.querySelector(
      '.aos-workspace-view[data-workspace="' + registry.IDS.TESTING + '"]'
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
  }

  AuditOS.testingWorkspace = {
    SLOTS: SLOTS,

    // Pure, offline-testable derivations.
    derivations: {
      formatDate: formatDate,
      formatPeriod: formatPeriod,
      normalizeFrameworks: normalizeFrameworks,
      deriveCurrentEngagement: deriveCurrentEngagement,
      resolveStatusTone: resolveStatusTone,
      resolveResultTone: resolveResultTone,
      resolveRelatedControl: resolveRelatedControl,
      relatedControlLabel: relatedControlLabel,
      deriveEvidenceStatus: deriveEvidenceStatus,
      normalizeMethodologyReuse: normalizeMethodologyReuse,
      deriveTestRow: deriveTestRow,
      deriveQueue: deriveQueue,
      deriveWorkpaperRows: deriveWorkpaperRows,
      matchesSearch: matchesSearch,
      deriveWorkpaperSuggestions: deriveWorkpaperSuggestions,
      sectionText: sectionText,
      deriveTestingHealth: deriveTestingHealth,
      deriveTestingProgress: deriveTestingProgress,
      deriveTestingStatus: deriveTestingStatus,
      deriveExceptions: deriveExceptions,
      testView: testView,
      controlGroupView: controlGroupView,
      resultView: resultView,
      deriveViews: deriveViews,
      deriveLineage: deriveLineage,
      deriveActivity: deriveActivity,
      deriveMetadata: deriveMetadata,
      deriveMethodologyReuseItems: deriveMethodologyReuseItems,
      deriveApprovalHistory: deriveApprovalHistory,
      buildTestInspector: buildTestInspector
    },

    collectViewModel: collectViewModel,

    // Host-agnostic Inspector renderer (§9): data → one self-contained node,
    // mountable in any host. Release 1 mounts the fuller Queue in primary content.
    renderInspector: renderInspector,

    /**
     * Binds the Testing Workspace to the router and the Shared Audit State. Safe
     * to call once, after the DOM is ready, the router has resolved the initial
     * route, and the framework has rendered its skeleton (script order guarantees
     * the framework's route listener runs first). Does nothing when the routing or
     * state foundations are absent, so the shell degrades rather than throwing.
     */
    init: function () {
      var router = AuditOS.router;
      var state = AuditOS.state;
      if (!AuditOS.workspaceRegistry || !router) {
        return;
      }

      global.document.addEventListener(router.ROUTE_CHANGED_EVENT, renderActiveTesting);
      if (state && typeof state.subscribe === 'function') {
        state.subscribe(state.EVENTS.STATE_LOADED, renderActiveTesting);
        state.subscribe(state.EVENTS.STATE_CHANGED, renderActiveTesting);
        state.subscribe(state.EVENTS.STATE_RESET, renderActiveTesting);
      }
      renderActiveTesting();
    }
  };

  // Self-initialize after the DOM is ready. Guarded so the module can load in
  // the offline test sandbox, where no document exists.
  if (global.document) {
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', AuditOS.testingWorkspace.init);
    } else {
      AuditOS.testingWorkspace.init();
    }
  }
})(window);
