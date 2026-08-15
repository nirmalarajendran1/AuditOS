/**
 * AuditOS Repository Foundation
 * Platform Foundation II — GitHub Issue #34 (Repository Architecture /
 * Simulated CRUD) / Shared Audit State — Chapter 9 / Chapter 45
 *
 * The single data-access layer between the UI and storage. Workspaces,
 * wizards, and platform surfaces read and write business entities through the
 * entity repositories declared here — never through demo-data JSON, and (from
 * Issue #34 on) never through `AuditOS.state` directly. Each repository wraps
 * the Shared Audit State store, preserving its proven semantics exactly:
 * defensive deep-clone reads, simulated in-memory writes (`SIM-` identifier
 * assignment, nothing persisted, demo-data files never touched), and the
 * store's own state events, which remain the one change-notification channel.
 *
 * Release 1 repositories simulate persistence because a portable file://
 * index.html cannot reliably write files. Release 2 replaces the repository
 * implementations (AI agents, real backends) behind these same interfaces
 * without requiring UI changes — that is the reason this layer exists now.
 *
 * Every repository write records one immutable event through the Platform
 * Audit Service (js/platform/audit-service.js) when it is loaded, carrying
 * the acting session, the entity reference, the previous and new values, and
 * the caller's context (reason, workspace, correlation id). Reads record
 * nothing.
 *
 * The repository also owns hierarchy resolution for the Repository-aware
 * router (Issue #34 — Breadcrumb Architecture): routing slugs for clients and
 * engagements, and `resolveHierarchy`, which resolves URL segments into
 * Client → Engagement → Workspace → Entity. The router parses segments only;
 * this module resolves them.
 *
 * Depends on nothing in components/, keeping the js → components boundary
 * one-way. Loaded as a classic script so the prototype runs directly from
 * file:///.../prototype/index.html with no build step or module loader.
 */
(function (global) {
  'use strict';

  var AuditOS = global.AuditOS = global.AuditOS || {};

  /**
   * Entity repository catalog: repository name → backing Shared Audit State
   * collection. This is the platform's complete Release 1 repository
   * coverage (Issue #34): every UI read or write of these entities goes
   * through the repository named here.
   */
  var ENTITIES = [
    { name: 'clients',          collectionId: 'companies' },
    { name: 'clientGroups',     collectionId: 'business-units' },
    { name: 'programs',         collectionId: 'programs' },
    { name: 'engagements',      collectionId: 'engagements' },
    { name: 'users',            collectionId: 'users' },
    { name: 'requirements',     collectionId: 'evidence-requirements' },
    { name: 'controls',         collectionId: 'controls' },
    { name: 'evidence',         collectionId: 'evidence' },
    { name: 'evidenceRequests', collectionId: 'evidence-requests' },
    { name: 'walkthroughs',     collectionId: 'walkthroughs' },
    { name: 'walkthroughTeams', collectionId: 'walkthrough-teams' },
    { name: 'reports',          collectionId: 'reports' },
    // Living Reporting (GitHub Issue #41): the report version register, whose
    // records accumulate at runtime as the report advances Draft → Issued.
    { name: 'reportVersions',   collectionId: 'report-versions' },
    { name: 'approvals',        collectionId: 'approvals' },
    { name: 'auditLogs',        collectionId: 'audit-logs' },
    { name: 'telemetry',        collectionId: 'ai-telemetry' },
    // Engagement Operating System Foundation (GitHub Issue #36): the
    // engagement-scoped collections the Suggestion Lifecycle, the AI Context
    // Service, and the Dependency Engine are backed by, plus the shared,
    // reusable Industry Knowledge library (Architectural Decision #5 —
    // Industry Knowledge is organizational, not engagement-specific).
    { name: 'suggestions',      collectionId: 'suggestions' },
    { name: 'engagementContext', collectionId: 'engagement-context' },
    { name: 'dependencies',     collectionId: 'dependencies' },
    { name: 'industryKnowledge', collectionId: 'industry-knowledge' },
    // The three operational collections that had no repository entry, closing
    // the coverage gap the README records as a known limitation. Their records
    // were already loaded and read through the Shared Audit State; what was
    // absent was the audited write path, and without it a Suggestion's
    // `applyTarget` naming one of them would resolve to an undefined
    // repository and silently write nothing on Apply — the suggestion marked
    // Applied with the record unchanged, which is the worst shape a failure
    // can take in an approval trail.
    { name: 'findings',         collectionId: 'findings' },
    { name: 'testing',          collectionId: 'testing' },
    { name: 'samples',          collectionId: 'samples' }
  ];

  /** Returns the value when it is an array, otherwise an empty array. */
  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  /** The Shared Audit State store, resolved at call time so load order stays flexible. */
  function stateStore() {
    return AuditOS.state || null;
  }

  /** The Platform Audit Service, when loaded; repository writes record through it. */
  function auditService() {
    return AuditOS.auditService || null;
  }

  /**
   * Records one audit event for a repository write. Absent audit service or
   * an explicit `silent` option (used by the audit log's own storage to avoid
   * recursion) records nothing. Context fields fall back to the values the
   * written record itself carries, so callers only state what the record
   * cannot.
   */
  function recordWriteEvent(action, collectionId, recordId, previousValue, newValue, options) {
    var service = auditService();
    var context = options || {};
    if (!service || context.silent) {
      return;
    }
    var reference = newValue || previousValue || {};
    service.record({
      action: context.action || action,
      entity: { collection: collectionId, recordId: recordId, datasetId: context.datasetId || null },
      previousValue: previousValue,
      newValue: newValue,
      reason: context.reason || null,
      approvalChain: context.approvalChain || null,
      companyId: context.companyId || reference.companyId || null,
      programId: context.programId || reference.programId || null,
      engagementId: context.engagementId || reference.engagementId || null,
      workspaceId: context.workspaceId || null,
      correlationId: context.correlationId || null,
      metadata: context.metadata || null
    });
  }

  /**
   * Builds one entity repository over a Shared Audit State collection. Reads
   * delegate to the store's deep-clone read API; writes delegate to the
   * store's simulated write API and record one audit event each. `options`
   * on every method is `{ datasetId, action, reason, workspaceId,
   * correlationId, approvalChain, companyId, programId, engagementId,
   * metadata, silent }` — engagement-scoped collections require `datasetId`,
   * shared collections ignore it.
   */
  function createRepository(entity) {
    var collectionId = entity.collectionId;
    return {
      collectionId: collectionId,

      /** The records of the collection (one dataset for engagement scope), or []. */
      list: function (options) {
        var state = stateStore();
        var datasetId = options && options.datasetId;
        return state ? state.listRecords(collectionId, datasetId) : [];
      },

      /** One record by identifier, or null. */
      get: function (recordId, options) {
        var state = stateStore();
        var datasetId = options && options.datasetId;
        return state ? state.getRecord(collectionId, recordId, datasetId) : null;
      },

      /** The full document (metadata and structural keys included), or null. */
      getDocument: function (options) {
        var state = stateStore();
        var datasetId = options && options.datasetId;
        return state ? state.getDocument(collectionId, datasetId) : null;
      },

      /** Dataset identifiers currently held (engagement scope), or []. */
      datasetIds: function () {
        var state = stateStore();
        return state ? state.getDatasetIds(collectionId) : [];
      },

      /** Dataset identifiers whose document metadata declares the engagement. */
      datasetsForEngagement: function (engagementId) {
        var state = stateStore();
        return state ? state.findDatasetsForEngagement(collectionId, engagementId) : [];
      },

      /** Simulated create. Returns the stored record copy, or null. Records one audit event. */
      create: function (record, options) {
        var state = stateStore();
        if (!state) {
          return null;
        }
        var datasetId = options && options.datasetId;
        var stored = state.createRecord(collectionId, record, datasetId);
        if (stored) {
          recordWriteEvent('record-created', collectionId, stored.id, null, stored, options);
        }
        return stored;
      },

      /** Simulated update. Returns the updated record copy, or null. Records one audit event. */
      update: function (recordId, changes, options) {
        var state = stateStore();
        if (!state) {
          return null;
        }
        var datasetId = options && options.datasetId;
        var previous = state.getRecord(collectionId, recordId, datasetId);
        var updated = state.updateRecord(collectionId, recordId, changes, datasetId);
        if (updated) {
          recordWriteEvent('record-updated', collectionId, recordId, previous, updated, options);
        }
        return updated;
      },

      /** Simulated remove. Returns true when removed. Records one audit event. */
      remove: function (recordId, options) {
        var state = stateStore();
        if (!state) {
          return false;
        }
        var datasetId = options && options.datasetId;
        var previous = state.getRecord(collectionId, recordId, datasetId);
        var removed = state.removeRecord(collectionId, recordId, datasetId);
        if (removed) {
          recordWriteEvent('record-removed', collectionId, recordId, previous, null, options);
        }
        return removed;
      }
    };
  }

  // ------------------------------------------------------------------
  // Hierarchy resolution — routing slugs and segment resolution for the
  // Repository-aware router and the hierarchical breadcrumb (Issue #34).
  // ------------------------------------------------------------------

  /**
   * Normalizes a value into a stable, lowercase, hyphenated routing slug.
   * Deterministic: derived from recorded identifiers only, never stored.
   */
  function slugify(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /** The routing slug of a client: its recorded code, else its name. */
  function clientSlug(company) {
    if (!company) {
      return '';
    }
    return slugify(company.code || company.name || company.id);
  }

  /** The routing slug of an engagement: its recorded engagement code, else its id. */
  function engagementSlug(engagement) {
    if (!engagement) {
      return '';
    }
    return slugify(engagement.engagementCode || engagement.id);
  }

  /**
   * The clients the session may access, in record order. The Release 1 demo
   * session is platform-wide; a session that declares `companyIds` is
   * restricted to them — the seam Release 2 access control fills in.
   */
  function listAccessibleClients(session) {
    var repository = AuditOS.repository;
    var companies = repository.clients.list();
    if (session && Array.isArray(session.companyIds)) {
      return companies.filter(function (company) {
        return session.companyIds.indexOf(company.id) !== -1;
      });
    }
    return companies;
  }

  /**
   * The engagements the session may access, optionally scoped to one client,
   * in record order. A session that declares `engagementIds` is restricted
   * to them.
   */
  function listAccessibleEngagements(companyId, session) {
    var repository = AuditOS.repository;
    return repository.engagements.list().filter(function (engagement) {
      if (companyId && engagement.companyId !== companyId) {
        return false;
      }
      if (session && Array.isArray(session.engagementIds)) {
        return session.engagementIds.indexOf(engagement.id) !== -1;
      }
      return true;
    });
  }

  /** Finds the client whose routing slug matches, or null. */
  function findClientBySlug(slug, session) {
    var matches = listAccessibleClients(session).filter(function (company) {
      return clientSlug(company) === slug;
    });
    return matches.length > 0 ? matches[0] : null;
  }

  /** Finds the engagement (optionally within one client) whose routing slug matches, or null. */
  function findEngagementBySlug(slug, companyId, session) {
    var matches = listAccessibleEngagements(companyId, session).filter(function (engagement) {
      return engagementSlug(engagement) === slug;
    });
    return matches.length > 0 ? matches[0] : null;
  }

  /**
   * Resolves hierarchical route segments (Issue #34 — Breadcrumb
   * Architecture) into Client → Engagement → Workspace → Entity:
   *
   *   [clientSlug]                          → Client Dashboard
   *   [clientSlug, engagementSlug]          → Engagement workspace
   *   [clientSlug, engagementSlug, path]    → that workspace
   *   [clientSlug, engagementSlug, path, id]→ that workspace, record selected
   *
   * The Walkthrough workspace (GitHub Issue #36 — Engagement Operating
   * System Foundation) carries two further levels: Team, then POC —
   *   [..., 'walkthroughs', teamId]           → Team workspace
   *   [..., 'walkthroughs', teamId, pocId]    → POC detail within that Team
   * `recordId` still carries the raw fourth segment (unchanged contract for
   * every other workspace); `teamId`/`pocId` are additional, Walkthrough-only
   * fields that stay '' everywhere else.
   *
   * The router parses URL segments only; this resolver turns them into
   * entities. When a later segment cannot be resolved the remaining segments
   * are ignored and the deepest valid parent wins; when nothing resolves the
   * result is null and the router falls back to Home. While the state store
   * is still loading the result is `{ pending: true }` so the router can
   * re-resolve once the state is ready.
   */
  function resolveHierarchy(segments, workspaceRegistry) {
    var state = stateStore();
    var parts = asArray(segments).filter(function (segment) { return segment !== ''; });
    if (parts.length === 0 || !workspaceRegistry) {
      return null;
    }
    if (!state || !state.isReady()) {
      return { pending: true };
    }

    var client = findClientBySlug(slugify(parts[0]));
    if (!client) {
      return null;
    }

    var context = {
      client: client,
      clientSlug: clientSlug(client),
      engagement: null,
      engagementSlug: '',
      workspaceId: workspaceRegistry.IDS.CLIENT,
      recordId: '',
      teamId: '',
      pocId: '',
      depth: 1
    };

    var engagement = parts.length > 1
      ? findEngagementBySlug(slugify(parts[1]), client.id) : null;
    if (!engagement) {
      return context;
    }
    context.engagement = engagement;
    context.engagementSlug = engagementSlug(engagement);
    context.workspaceId = workspaceRegistry.IDS.ENGAGEMENT;
    context.depth = 2;

    var workspace = parts.length > 2 ? workspaceRegistry.findByPath(parts[2]) : null;
    if (!workspace) {
      return context;
    }
    context.workspaceId = workspace.id;
    context.depth = 3;

    if (parts.length > 3 && parts[3]) {
      var recordId = decodeSegment(parts[3]);
      context.recordId = recordId;
      context.depth = 4;

      // Team → POC depth is Walkthrough-only (Issue #36); every other
      // workspace's fourth segment stays the plain `recordId` it always was.
      if (workspace.id === workspaceRegistry.IDS.WALKTHROUGH) {
        context.teamId = recordId;
        if (parts.length > 4 && parts[4]) {
          context.pocId = decodeSegment(parts[4]);
          context.depth = 5;
        }
      }
    }
    return context;
  }

  /** Decodes one URL path segment, keeping the raw value on a malformed escape. */
  function decodeSegment(segment) {
    try {
      // decodeURIComponent is an ECMAScript builtin, reachable in every
      // execution context (browser and offline test sandbox alike).
      return decodeURIComponent(segment);
    } catch (error) {
      return segment;
    }
  }

  /**
   * Builds the canonical hierarchical route hash for a resolved context:
   * `#/{clientSlug}[/{engagementSlug}[/{workspacePath}[/{recordId}[/{pocId}]]]]`.
   * Segments beyond the deepest supplied entity are omitted. For the
   * Walkthrough workspace, `recordId` carries the Team and a further
   * `pocId` segment carries the POC (Issue #36 — Team → POC depth).
   */
  function buildHierarchicalHash(context, workspaceRegistry) {
    if (!context || !context.client) {
      return null;
    }
    var segments = [clientSlug(context.client)];
    if (context.engagement) {
      segments.push(engagementSlug(context.engagement));
      var workspace = context.workspaceId && workspaceRegistry
        ? workspaceRegistry.findById(context.workspaceId) : null;
      if (workspace && workspace.id !== workspaceRegistry.IDS.ENGAGEMENT) {
        segments.push(workspace.path);
        if (context.recordId) {
          segments.push(encodeURIComponent(context.recordId));
          if (workspace.id === workspaceRegistry.IDS.WALKTHROUGH && context.pocId) {
            segments.push(encodeURIComponent(context.pocId));
          }
        }
      }
    }
    return '#/' + segments.join('/');
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  var repository = {
    ENTITIES: ENTITIES.map(function (entity) { return entity.name; }),

    slugify: slugify,
    clientSlug: clientSlug,
    engagementSlug: engagementSlug,
    listAccessibleClients: listAccessibleClients,
    listAccessibleEngagements: listAccessibleEngagements,
    findClientBySlug: findClientBySlug,
    findEngagementBySlug: findEngagementBySlug,
    resolveHierarchy: resolveHierarchy,
    buildHierarchicalHash: buildHierarchicalHash,

    /** Whether the backing store has loaded; UI surfaces read this instead of the store. */
    isReady: function () {
      var state = stateStore();
      return Boolean(state && state.isReady());
    },

    /** Store status snapshot (degraded/demo-data diagnostics), or null. */
    getStatus: function () {
      var state = stateStore();
      return state ? state.getStatus() : null;
    },

    /** Discards every simulated write and restores the demo-data baseline. */
    reset: function () {
      var state = stateStore();
      return state ? state.reset() : false;
    }
  };

  ENTITIES.forEach(function (entity) {
    repository[entity.name] = createRepository(entity);
  });

  // AI Usage reads the same telemetry records (Issue #34 — AI Usage /
  // AI Telemetry Platform are one dataset, two surfaces).
  repository.aiUsage = repository.telemetry;

  AuditOS.repository = repository;
})(window);
