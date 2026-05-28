import { createRedisClient } from "@/lib/redis";

export async function GET(request: Request): Promise<Response> {
  // Optional ?taskId=... → only forward events for that task. Omit to receive
  // the global firehose (used by the task list / multi-task overview).
  const url = new URL(request.url);
  const filterTaskId = url.searchParams.get("taskId");

  const subscriber = createRedisClient();

  const stream = new ReadableStream({
    start(controller) {
      subscriber.subscribe("scan-events", (err) => {
        if (err) {
          controller.error(err);
          return;
        }
      });

      subscriber.on("message", (_channel: string, message: string) => {
        if (filterTaskId !== null) {
          // Cheap filter — peek at the taskId without parsing fully.
          // Worker tags every event with { taskId, ... }. If the field is
          // missing (old event shape) or doesn't match, drop it.
          try {
            const parsed = JSON.parse(message) as { taskId?: string };
            if (parsed.taskId !== filterTaskId) return;
          } catch {
            return;
          }
        }
        controller.enqueue(`data: ${message}\n\n`);
      });

      request.signal.addEventListener("abort", () => {
        subscriber.unsubscribe("scan-events").finally(() => {
          subscriber.quit().catch(() => {});
          controller.close();
        });
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
