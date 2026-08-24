import { Queue, Worker, JobsOptions } from "bullmq";
import { PrismaService } from "../prisma.service";
import { StorageService } from "../storage/storage.service";
import { processImageJob } from "../media/media-processor";

export const IMAGE_QUEUE = "pic-media";

let queue: Queue | null = null;
let worker: Worker | null = null;

function redisConnection() {
  const url = process.env.REDIS_URL || "redis://127.0.0.1:6379";
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    password: u.password || undefined,
    maxRetriesPerRequest: null as null,
  };
}

export function getImageQueue(): Queue {
  if (!queue) {
    queue = new Queue(IMAGE_QUEUE, { connection: redisConnection() });
  }
  return queue;
}

export async function enqueueImageProcess(assetId: string, spaceId: string): Promise<void> {
  const opts: JobsOptions = {
    jobId: `image-process-${assetId}`,
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 200,
    removeOnFail: 200,
  };
  if (process.env.JOBS_INLINE === "true") {
    return;
  }
  try {
    await getImageQueue().add("image.process", { assetId, spaceId }, opts);
  } catch (err) {
    console.error("enqueue image.process failed", err);
  }
}

export function startImageWorker(prisma: PrismaService, storage: StorageService): Worker | null {
  if (process.env.RUN_WORKER === "false") return null;
  if (worker) return worker;
  worker = new Worker(
    IMAGE_QUEUE,
    async (job) => {
      const assetId = job.data.assetId as string;
      await processImageJob({ prisma, storage }, assetId);
    },
    { connection: redisConnection(), concurrency: 2 },
  );
  worker.on("error", (err) => console.error("image worker error", err));
  worker.on("failed", (job, err) => console.error("image job failed", job?.id, err));
  worker.on("completed", (job) => console.log("image job completed", job.id));
  worker.on("ready", () => console.log("image worker ready"));
  console.log("image worker starting");
  return worker;
}

export async function stopImageWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (queue) {
    await queue.close();
    queue = null;
  }
}
