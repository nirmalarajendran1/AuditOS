/**
 * AuditOS AI Client
 * AI Implementation Context / Release 2 AI Foundation
 *
 * The single outbound-call surface of the platform (`window.AuditOS.aiClient`).
 * Every other module in `prototype/` is offline by construction; this one file
 * is the only place that knows a network exists, so the rest of the codebase
 * keeps its "reads state, renders DOM" shape and a future provider change
 * touches nothing but the backend and this module's request builder.
 *
 * Transport only. It holds no prompt, no model identifier, and no business
 * rule about what a narrative should say — all of that lives server-side in
 * `backend/main.py`, because a prompt shipped to the browser can be edited in
 * the console and its grounding constraint is what keeps a drafted narrative
 * honest.
 *
 * The AI backend is optional. When it is not running — the normal state for a
 * prototype opened straight from `file://` — every call resolves to `null` and
 * the application behaves exactly as it did before AI existed. Failure is
 * always a `null`, never a thrown error and never a partial result, so no
 * caller has to defend against a half-formed response.
 *
 * Depends on nothing in components/, keeping the js → components boundary
 * one-way. Loaded as a classic script so the prototype runs directly from
 * file:///.../prototype/index.html with no build step or module loader.
 */
(function (global) {
  'use strict';

  var AuditOS = global.AuditOS = global.AuditOS || {};

  /**
   * Where the AI backend listens. Loopback only — the service holds the model
   * credential and is never intended to be reachable off the machine running
   * it. Overridable at runtime (`AuditOS.aiClient.configure`) so a deployment
   * can point at a hosted backend without editing source.
   */
  var DEFAULT_BASE_URL = 'http://127.0.0.1:8787';

  /** Request ceilings, so a hung backend can never freeze a render path. */
  var HEALTH_TIMEOUT_MS = 1500;
  var NARRATIVE_TIMEOUT_MS = 30000;

  var baseUrl = DEFAULT_BASE_URL;

  /**
   * Memoized availability. `null` = not yet probed. The probe runs once per
   * session: a workspace re-renders on every state change, and re-probing a
   * missing backend on each of those would spend the render path on requests
   * already known to fail.
   */
  var availability = null;
  var availabilityProbe = null;

  /** Whether this environment can make requests at all (Node tests cannot). */
  function canFetch() {
    return typeof global.fetch === 'function';
  }

  /**
   * `fetch` with a hard deadline. AbortController is used where present and
   * degrades to a plain timeout race where it is not, so the client stays
   * usable in the offline Node test sandbox as well as the browser.
   */
  function fetchWithTimeout(url, options, timeoutMs) {
    var settings = options || {};
    if (typeof global.AbortController !== 'function') {
      return global.fetch(url, settings);
    }
    var controller = new global.AbortController();
    settings.signal = controller.signal;
    var timer = global.setTimeout(function () { controller.abort(); }, timeoutMs);
    return global.fetch(url, settings).then(function (response) {
      global.clearTimeout(timer);
      return response;
    }, function (error) {
      global.clearTimeout(timer);
      throw error;
    });
  }

  /**
   * Whether the backend is reachable *and* holds a credential. A running
   * service with no key configured reports `configured: false` and is treated
   * as unavailable — the honest answer, since it cannot draft anything.
   */
  function probeAvailability() {
    if (!canFetch()) {
      availability = false;
      return Promise.resolve(false);
    }
    return fetchWithTimeout(baseUrl + '/api/health', { method: 'GET' }, HEALTH_TIMEOUT_MS)
      .then(function (response) {
        if (!response || !response.ok) {
          return false;
        }
        return response.json().then(function (body) {
          return Boolean(body && body.configured);
        });
      })
      .catch(function () {
        return false;
      })
      .then(function (result) {
        availability = result;
        return result;
      });
  }

  AuditOS.aiClient = {
    /** Overrides the backend origin. Resets the memoized availability probe. */
    configure: function (options) {
      var settings = options || {};
      if (typeof settings.baseUrl === 'string' && settings.baseUrl) {
        baseUrl = settings.baseUrl.replace(/\/+$/, '');
      }
      availability = null;
      availabilityProbe = null;
    },

    /** The configured backend origin. */
    getBaseUrl: function () {
      return baseUrl;
    },

    /**
     * The last known availability without triggering a probe: `true`, `false`,
     * or `null` when nothing has been checked yet. Synchronous, so a render
     * path can branch on it without awaiting anything.
     */
    availabilitySnapshot: function () {
      return availability;
    },

    /**
     * Resolves true when the backend is reachable and configured. Probed once
     * per session and memoized thereafter; never rejects.
     */
    isAvailable: function () {
      if (availability !== null) {
        return Promise.resolve(availability);
      }
      if (!availabilityProbe) {
        availabilityProbe = probeAvailability();
      }
      return availabilityProbe;
    },

    /**
     * Requests a drafted narrative paragraph for one report section.
     *
     * Resolves to `{ text, provider, model, inputTokens, outputTokens,
     * latencyMs }` on success, or to `null` for every failure mode there is —
     * backend absent, key unconfigured, provider error, timeout, malformed
     * response. Callers treat `null` as "no narrative", which is the state the
     * application already renders correctly.
     */
    requestNarrative: function (request) {
      var payload = request || {};
      if (!canFetch() || !payload.engagementId || !payload.sectionKey ||
          !payload.blocks || payload.blocks.length === 0) {
        return Promise.resolve(null);
      }

      return fetchWithTimeout(baseUrl + '/api/narrative', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          engagementId: payload.engagementId,
          sectionKey: payload.sectionKey,
          blocks: payload.blocks.map(function (block) {
            return {
              label: block.label || '',
              text: block.text || '',
              present: Boolean(block.present)
            };
          })
        })
      }, NARRATIVE_TIMEOUT_MS)
        .then(function (response) {
          if (!response || !response.ok) {
            return null;
          }
          return response.json();
        })
        .then(function (body) {
          if (!body || typeof body.text !== 'string' || !body.text.trim()) {
            return null;
          }
          return {
            text: body.text.trim(),
            provider: body.provider || '',
            model: body.model || '',
            inputTokens: typeof body.inputTokens === 'number' ? body.inputTokens : null,
            outputTokens: typeof body.outputTokens === 'number' ? body.outputTokens : null,
            latencyMs: typeof body.latencyMs === 'number' ? body.latencyMs : null
          };
        })
        .catch(function () {
          return null;
        });
    }
  };
})(window);
