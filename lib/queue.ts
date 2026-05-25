import { Queue } from "bullmq";
import { redis } from "./redis";

export type ScanJobData = {
  taskId: string;
  targetUrl: string;
};

export const scanQueue = new Queue<ScanJobData>("scan-queue", {
  connection: redis,
});
