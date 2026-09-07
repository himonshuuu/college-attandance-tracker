import { runMonitorCycle } from "./monitor";
import { Env } from "./types";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

const worker: ExportedHandler<Env> = {
  async fetch(request, env) {
    if (request.method !== "GET" || new URL(request.url).pathname !== "/") {
      return jsonResponse({ success: false, error: "Not found" }, 404);
    }

    try {
      const summary = await runMonitorCycle(env);
      return jsonResponse(summary, summary.success ? 200 : 502);
    } catch {
      // Do not return exception text: it can contain data from a third-party
      // runtime or an accidentally included credential.
      console.error(JSON.stringify({ event: "manual-cycle-error" }));
      return jsonResponse(
        { success: false, error: "Monitor cycle failed. Check Worker logs." },
        500,
      );
    }
  },

  async scheduled(_event, env, context) {
    context.waitUntil(
      runMonitorCycle(env).catch(() => {
        console.error(JSON.stringify({ event: "scheduled-cycle-error" }));
      }),
    );
  },
};

export default worker;
