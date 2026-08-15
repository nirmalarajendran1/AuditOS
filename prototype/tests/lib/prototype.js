'use strict';

/**
 * AuditOS Prototype Test Access
 *
 * Shared helpers that let the offline test suites read prototype source files
 * and execute the prototype's classic (window-scoped IIFE) scripts without a
 * browser. The catalog scripts only touch `window`, so a minimal sandbox
 * reproduces exactly how index.html loads them — no DOM, no Playwright, no
 * network — keeping the suites fully offline (AI Implementation Context —
 * file:// / offline constraint).
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/** Absolute path to the prototype root (this file lives in prototype/tests/lib). */
const PROTOTYPE_DIR = path.resolve(__dirname, '..', '..');

/**
 * Path segments of the prototype's classic (window-scoped) scripts, so suites
 * reference a named constant instead of repeating path literals (Coding
 * Standards §30.11). Future issues register their scripts here.
 */
const SCRIPTS = {
  componentLibrary: ['components', 'component-library', 'component-library.js'],
  presentation: ['components', 'presentation', 'presentation.js'],
  workspaceRegistry: ['js', 'router', 'workspace-registry.js'],
  router: ['js', 'router', 'router.js'],
  navigationService: ['js', 'services', 'navigation-service.js'],
  contextResolver: ['js', 'services', 'context-resolver.js'],
  hierarchyBuilder: ['js', 'services', 'hierarchy-builder.js'],
  breadcrumbGenerator: ['js', 'services', 'breadcrumb-generator.js'],
  evidenceLifecycle: ['js', 'services', 'evidence-lifecycle.js'],
  aiLineage: ['js', 'services', 'ai-lineage-service.js'],
  workpaperService: ['js', 'services', 'workpaper-service.js'],
  workbookExport: ['js', 'services', 'workbook-export.js'],
  workpaperExport: ['js', 'services', 'workpaper-export.js'],
  reportGeneration: ['js', 'services', 'report-generation-service.js'],
  reportVersion: ['js', 'services', 'report-version-service.js'],
  reportPropagation: ['js', 'services', 'report-propagation-service.js'],
  documentExport: ['js', 'services', 'document-export.js'],
  aiClient: ['js', 'services', 'ai-client.js'],
  narrativeAgent: ['js', 'services', 'narrative-agent.js'],
  impactAgent: ['js', 'services', 'impact-agent.js'],
  demoDataBundle: ['demo-data', 'demo-data.js'],
  demoDataRegistry: ['js', 'state', 'demo-data-registry.js'],
  stateStore: ['js', 'state', 'state-store.js'],
  relationships: ['js', 'platform', 'relationships.js'],
  idService: ['js', 'platform', 'id-service.js'],
  permissions: ['js', 'platform', 'permissions.js'],
  auditService: ['js', 'platform', 'audit-service.js'],
  repository: ['js', 'platform', 'repository.js'],
  synchronizationBus: ['js', 'platform', 'synchronization-bus.js'],
  engagementContextService: ['js', 'platform', 'engagement-context-service.js'],
  dependencyService: ['js', 'platform', 'dependency-service.js'],
  industryKnowledge: ['js', 'platform', 'industry-knowledge.js'],
  suggestionService: ['js', 'platform', 'suggestion-service.js'],
  workspaceShared: ['components', 'workspace-shared', 'workspace-shared.js'],
  homeWorkspace: ['js', 'workspaces', 'home.js'],
  engagementWorkspace: ['js', 'workspaces', 'engagement.js'],
  walkthroughWorkspace: ['js', 'workspaces', 'walkthrough.js'],
  evidenceWorkspace: ['js', 'workspaces', 'evidence.js'],
  controlsWorkspace: ['js', 'workspaces', 'controls.js'],
  testingWorkspace: ['js', 'workspaces', 'testing.js'],
  findingsWorkspace: ['js', 'workspaces', 'findings.js'],
  reportingWorkspace: ['js', 'workspaces', 'reporting.js'],
  programWorkspace: ['js', 'workspaces', 'program.js'],
  clientDashboardWorkspace: ['js', 'workspaces', 'client-dashboard.js'],
  globalApprovalsWorkspace: ['js', 'workspaces', 'global-approvals.js'],
  aiUsageWorkspace: ['js', 'workspaces', 'ai-usage.js'],
  workspaceFramework: ['components', 'workspace-framework', 'workspace-framework.js'],
  wizardEngine: ['components', 'wizard', 'wizard.js'],
  platformFooter: ['components', 'footer', 'footer.js'],
  navigation: ['components', 'navigation', 'navigation.js'],
  globalHeader: ['components', 'header', 'header.js'],
  auditLogWorkspace: ['js', 'workspaces', 'audit-log.js'],
  clientWizardWorkspace: ['js', 'workspaces', 'client-wizard.js'],
  engagementWizardWorkspace: ['js', 'workspaces', 'engagement-wizard.js']
};

/** Resolves a path inside the prototype from path segments. */
function prototypePath() {
  const segments = Array.prototype.slice.call(arguments);
  return path.join.apply(path, [PROTOTYPE_DIR].concat(segments));
}

/** Reads a UTF-8 prototype file from path segments. */
function readText() {
  return fs.readFileSync(prototypePath.apply(null, arguments), 'utf8');
}

/**
 * Executes a classic prototype script in an isolated sandbox whose global
 * exposes a fresh `window`, mirroring how the browser evaluates the script tag.
 * Returns the populated `window` so a suite can read what the script registered
 * (e.g. `window.AuditOS.componentLibrary`).
 */
function loadClassicScript(segments) {
  const code = fs.readFileSync(prototypePath.apply(null, segments), 'utf8');
  const windowObject = { console: console };
  const sandbox = { window: windowObject };
  vm.runInNewContext(code, sandbox, { filename: segments.join('/') });
  return windowObject;
}

/**
 * Executes several classic prototype scripts, in order, against one shared
 * `window`, mirroring how index.html stacks its script tags. Returns the
 * populated window so a suite can exercise foundations that build on each
 * other (e.g. bundle → registry → state store → home workspace).
 */
function loadClassicScripts(scriptList) {
  const windowObject = { console: console };
  const sandbox = { window: windowObject };
  scriptList.forEach(function (segments) {
    const code = fs.readFileSync(prototypePath.apply(null, segments), 'utf8');
    vm.runInNewContext(code, sandbox, { filename: segments.join('/') });
  });
  return windowObject;
}

/** Loads the component library registry (window.AuditOS.componentLibrary). */
function loadComponentLibrary() {
  return loadClassicScript(SCRIPTS.componentLibrary).AuditOS.componentLibrary;
}

/**
 * Loads the Enterprise Data Presentation System
 * (window.AuditOS.presentation). The module only touches the DOM inside a
 * builder call, so it registers cleanly in the sandbox where no document
 * exists; a suite that exercises a DOM builder attaches a document to the
 * returned window first.
 */
function loadPresentation() {
  return loadClassicScript(SCRIPTS.presentation).AuditOS.presentation;
}

/** Loads the Home workspace module (window.AuditOS.homeWorkspace). */
function loadHomeWorkspace() {
  return loadClassicScript(SCRIPTS.homeWorkspace).AuditOS.homeWorkspace;
}

/**
 * Loads the Engagement workspace module (window.AuditOS.engagementWorkspace).
 * The module guards its DOM self-init on `document` and reads the presentation
 * system only inside DOM builders, so it registers cleanly in the sandbox where
 * no document exists; suites exercise its pure derivations directly.
 */
function loadEngagementWorkspace() {
  return loadClassicScripts([SCRIPTS.relationships, SCRIPTS.workspaceShared, SCRIPTS.engagementWorkspace]).AuditOS.engagementWorkspace;
}

/**
 * Loads the Shared Workspace Framework module
 * (window.AuditOS.workspaceFramework). The module guards its DOM self-init on
 * `document`, so it registers cleanly in the sandbox where no document exists.
 */
function loadWorkspaceFramework() {
  return loadClassicScript(SCRIPTS.workspaceFramework).AuditOS.workspaceFramework;
}

/**
 * Loads the Walkthrough workspace module (window.AuditOS.walkthroughWorkspace)
 * over the full platform stack (Issue #36 — the Team → POC command center
 * writes through the Repository, the Suggestion Lifecycle Service, and the
 * SynchronizationBus). The module guards its DOM self-init on `document` and
 * reads the presentation system only inside DOM builders, so it registers
 * cleanly in the sandbox where no document exists; suites exercise its pure
 * derivations directly.
 */
function loadWalkthroughWorkspace() {
  return loadClassicScripts([
    SCRIPTS.relationships, SCRIPTS.idService, SCRIPTS.permissions, SCRIPTS.auditService, SCRIPTS.repository,
    SCRIPTS.synchronizationBus, SCRIPTS.engagementContextService, SCRIPTS.dependencyService,
    SCRIPTS.industryKnowledge, SCRIPTS.suggestionService,
    SCRIPTS.workspaceShared, SCRIPTS.walkthroughWorkspace
  ]).AuditOS.walkthroughWorkspace;
}

/**
 * Loads the Evidence workspace module (window.AuditOS.evidenceWorkspace). The
 * module guards its DOM self-init on `document` and reads the presentation
 * system only inside DOM builders, so it registers cleanly in the sandbox where
 * no document exists; suites exercise its pure derivations directly.
 */
function loadEvidenceWorkspace() {
  return loadClassicScripts([
    SCRIPTS.relationships, SCRIPTS.workspaceShared,
    SCRIPTS.evidenceLifecycle, SCRIPTS.aiLineage, SCRIPTS.evidenceWorkspace
  ]).AuditOS.evidenceWorkspace;
}

/**
 * Loads the Controls workspace module (window.AuditOS.controlsWorkspace). The
 * module guards its DOM self-init on `document` and reads the presentation
 * system only inside DOM builders, so it registers cleanly in the sandbox where
 * no document exists; suites exercise its pure derivations directly.
 */
function loadControlsWorkspace() {
  return loadClassicScripts([SCRIPTS.relationships, SCRIPTS.workspaceShared, SCRIPTS.controlsWorkspace]).AuditOS.controlsWorkspace;
}

/**
 * Loads the Testing workspace module (window.AuditOS.testingWorkspace). The
 * module guards its DOM self-init on `document` and reads the presentation
 * system only inside DOM builders, so it registers cleanly in the sandbox where
 * no document exists; suites exercise its pure derivations directly.
 */
function loadTestingWorkspace() {
  return loadClassicScripts([SCRIPTS.relationships, SCRIPTS.workspaceShared, SCRIPTS.testingWorkspace]).AuditOS.testingWorkspace;
}

/**
 * Loads the Findings workspace module (window.AuditOS.findingsWorkspace). The
 * module guards its DOM self-init on `document` and reads the presentation
 * system only inside DOM builders, so it registers cleanly in the sandbox where
 * no document exists; suites exercise its pure derivations directly.
 */
function loadFindingsWorkspace() {
  return loadClassicScripts([SCRIPTS.relationships, SCRIPTS.workspaceShared, SCRIPTS.findingsWorkspace]).AuditOS.findingsWorkspace;
}

/**
 * Loads the Reporting workspace module (window.AuditOS.reportingWorkspace)
 * over the Living Reporting services it composes (Issue #41). The module
 * guards its DOM self-init on `document` and reads the presentation system
 * only inside DOM builders, so it registers cleanly in the sandbox where no
 * document exists; suites exercise its pure derivations directly.
 */
function loadReportingWorkspace() {
  return loadClassicScripts([
    SCRIPTS.relationships, SCRIPTS.idService, SCRIPTS.workspaceShared,
    SCRIPTS.workbookExport, SCRIPTS.reportGeneration, SCRIPTS.reportVersion,
    SCRIPTS.reportPropagation, SCRIPTS.documentExport, SCRIPTS.reportingWorkspace
  ]).AuditOS.reportingWorkspace;
}

/** Loads the Report Generation Service (window.AuditOS.reportGenerationService). */
function loadReportGenerationService() {
  return loadClassicScript(SCRIPTS.reportGeneration).AuditOS.reportGenerationService;
}

/**
 * Loads the AI Foundation (window.AuditOS.aiClient and .narrativeAgent) over
 * the Suggestion Lifecycle Service and Repository the agent proposes through.
 * Returns the populated window so a suite can stub `aiClient` and observe what
 * the agent files. No network is reachable in the sandbox — `fetch` is absent —
 * so the client degrades to its null path exactly as it does with no AI backend
 * running, which is the behaviour these suites assert on.
 */
function loadAiFoundation() {
  return loadClassicScripts([
    SCRIPTS.idService, SCRIPTS.permissions, SCRIPTS.auditService,
    SCRIPTS.demoDataBundle, SCRIPTS.demoDataRegistry, SCRIPTS.stateStore,
    SCRIPTS.repository, SCRIPTS.suggestionService,
    SCRIPTS.aiClient, SCRIPTS.narrativeAgent, SCRIPTS.impactAgent
  ]).AuditOS;
}

/**
 * Loads the Document Export service (window.AuditOS.documentExport) over the
 * Workbook Export ZIP writer it composes and the Report Generation Service
 * whose model it serializes. Returns the populated window so a suite can reach
 * both services.
 */
function loadDocumentExport() {
  return loadClassicScripts([
    SCRIPTS.workbookExport, SCRIPTS.reportGeneration, SCRIPTS.documentExport
  ]).AuditOS;
}

/**
 * Loads the Audit Program workspace module (window.AuditOS.programWorkspace).
 * The module guards its DOM self-init on `document` and reads the
 * presentation system only inside DOM builders, so it registers cleanly in
 * the sandbox where no document exists; suites exercise its pure derivations
 * directly.
 */
function loadProgramWorkspace() {
  return loadClassicScripts([SCRIPTS.relationships, SCRIPTS.workspaceShared, SCRIPTS.programWorkspace]).AuditOS.programWorkspace;
}

/**
 * Loads the Permission Foundation (window.AuditOS.permissions) — the static
 * capability descriptor behind Issue #33's permission-aware action pattern.
 * Pure reads only, so it registers cleanly in the sandbox.
 */
function loadPermissions() {
  return loadClassicScript(SCRIPTS.permissions).AuditOS.permissions;
}

/**
 * Loads the Client Dashboard workspace module
 * (window.AuditOS.clientDashboardWorkspace). The module guards its DOM
 * self-init on `document` and reads the presentation system only inside DOM
 * builders, so it registers cleanly in the sandbox where no document exists;
 * suites exercise its pure derivations directly.
 */
function loadClientDashboardWorkspace() {
  return loadClassicScripts([SCRIPTS.relationships, SCRIPTS.workspaceShared, SCRIPTS.clientDashboardWorkspace]).AuditOS.clientDashboardWorkspace;
}

/**
 * Loads the Global Approvals workspace module
 * (window.AuditOS.globalApprovalsWorkspace). The module guards its DOM
 * self-init on `document` and reads the presentation system only inside DOM
 * builders, so it registers cleanly in the sandbox where no document exists;
 * suites exercise its pure derivations directly.
 */
function loadGlobalApprovalsWorkspace() {
  return loadClassicScripts([SCRIPTS.relationships, SCRIPTS.permissions, SCRIPTS.auditService, SCRIPTS.repository, SCRIPTS.workspaceShared, SCRIPTS.globalApprovalsWorkspace]).AuditOS.globalApprovalsWorkspace;
}

/**
 * Loads the AI Usage workspace module (window.AuditOS.aiUsageWorkspace). The
 * module guards its DOM self-init on `document` and reads the presentation
 * system only inside DOM builders, so it registers cleanly in the sandbox
 * where no document exists; suites exercise its pure derivations directly.
 */
function loadAiUsageWorkspace() {
  return loadClassicScripts([SCRIPTS.relationships, SCRIPTS.permissions, SCRIPTS.auditService, SCRIPTS.repository, SCRIPTS.workspaceShared, SCRIPTS.aiUsageWorkspace]).AuditOS.aiUsageWorkspace;
}

/**
 * Loads the shared Wizard Engine (window.AuditOS.wizard). The module only
 * touches the DOM inside `create`, so it registers cleanly in the sandbox.
 */
function loadWizardEngine() {
  return loadClassicScript(SCRIPTS.wizardEngine).AuditOS.wizard;
}

/**
 * Loads the Client Creation Wizard workspace
 * (window.AuditOS.clientWizardWorkspace) over the platform foundations.
 */
function loadClientWizardWorkspace() {
  return loadClassicScripts([SCRIPTS.permissions, SCRIPTS.auditService, SCRIPTS.repository, SCRIPTS.workspaceShared, SCRIPTS.wizardEngine, SCRIPTS.clientWizardWorkspace]).AuditOS.clientWizardWorkspace;
}

/**
 * Loads the Engagement Creation Wizard workspace
 * (window.AuditOS.engagementWizardWorkspace) over the platform foundations.
 */
function loadEngagementWizardWorkspace() {
  return loadClassicScripts([SCRIPTS.permissions, SCRIPTS.auditService, SCRIPTS.repository, SCRIPTS.workspaceShared, SCRIPTS.wizardEngine, SCRIPTS.engagementWizardWorkspace]).AuditOS.engagementWizardWorkspace;
}

/**
 * Loads the Global Audit Log workspace (window.AuditOS.auditLogWorkspace)
 * over the platform foundations.
 */
function loadAuditLogWorkspace() {
  return loadClassicScripts([SCRIPTS.permissions, SCRIPTS.auditService, SCRIPTS.repository, SCRIPTS.workspaceShared, SCRIPTS.auditLogWorkspace]).AuditOS.auditLogWorkspace;
}

/**
 * Normalizes a value produced inside the vm sandbox into this realm. Arrays
 * created in the sandbox have a different Array.prototype, which trips strict
 * deep-equality; suites pass registry-derived collections through this before
 * comparing them against host-realm expectations.
 */
function toHostArray(value) {
  return Array.from(value);
}

/**
 * Builds the route context an engagement-scoped workspace resolves against
 * (GitHub Issue #39 — the Context Resolver contract). Engagement-scoped
 * workspaces no longer fall back to a "current" engagement: they are only
 * reached through a hierarchical route, so a suite must supply the engagement
 * in scope exactly as the router would. This names the first In-Progress
 * engagement in the loaded state (else the first), the same engagement the
 * former shared fallback selected, so the assertions still describe the same
 * records. Returns null when no engagement exists (a degraded state), which
 * the workspace resolves to its degraded model.
 */
function engagementRouteContext(AuditOS) {
  var engagements = AuditOS && AuditOS.state && AuditOS.state.isReady()
    ? AuditOS.state.listRecords('engagements') : [];
  var target = null;
  for (var index = 0; index < engagements.length; index += 1) {
    if (!target && engagements[index].status === 'In Progress') {
      target = engagements[index];
    }
  }
  target = target || engagements[0] || null;
  return target ? { engagement: { id: target.id } } : null;
}

module.exports = {
  PROTOTYPE_DIR: PROTOTYPE_DIR,
  SCRIPTS: SCRIPTS,
  prototypePath: prototypePath,
  readText: readText,
  loadClassicScript: loadClassicScript,
  loadClassicScripts: loadClassicScripts,
  loadComponentLibrary: loadComponentLibrary,
  loadPresentation: loadPresentation,
  loadHomeWorkspace: loadHomeWorkspace,
  loadEngagementWorkspace: loadEngagementWorkspace,
  loadWalkthroughWorkspace: loadWalkthroughWorkspace,
  loadEvidenceWorkspace: loadEvidenceWorkspace,
  loadControlsWorkspace: loadControlsWorkspace,
  loadTestingWorkspace: loadTestingWorkspace,
  loadFindingsWorkspace: loadFindingsWorkspace,
  loadReportingWorkspace: loadReportingWorkspace,
  loadReportGenerationService: loadReportGenerationService,
  loadAiFoundation: loadAiFoundation,
  loadDocumentExport: loadDocumentExport,
  loadProgramWorkspace: loadProgramWorkspace,
  loadPermissions: loadPermissions,
  loadClientDashboardWorkspace: loadClientDashboardWorkspace,
  loadGlobalApprovalsWorkspace: loadGlobalApprovalsWorkspace,
  loadAiUsageWorkspace: loadAiUsageWorkspace,
  loadWorkspaceFramework: loadWorkspaceFramework,
  loadWizardEngine: loadWizardEngine,
  loadClientWizardWorkspace: loadClientWizardWorkspace,
  loadEngagementWizardWorkspace: loadEngagementWizardWorkspace,
  loadAuditLogWorkspace: loadAuditLogWorkspace,
  toHostArray: toHostArray,
  engagementRouteContext: engagementRouteContext
};
