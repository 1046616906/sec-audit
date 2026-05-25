import { createRedisClient } from "@/lib/redis";

export async function GET(request: Request): Promise<Response> {
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
