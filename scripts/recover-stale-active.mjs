#!/usr/bin/env node
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Queue } = require("bullmq");

const args = process.argv.slice(2);
const name =
  args.find((arg) => !arg.startsWith("--")) || "track-download-processor";
const clearLocks = args.includes("--clear-locks");
const connection = {
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: Number(process.env.REDIS_PORT || 6379),
};
const queue = new Queue(name, { connection });

try {
  if (!(await queue.isPaused())) {
    throw new Error(`Refusing recovery because ${name} is not paused`);
  }
  const client = await queue.client;
  const activeKey = queue.toKey("active");
  const pausedKey = queue.toKey("paused");
  const stalledKey = queue.toKey("stalled");
  const eventsKey = queue.toKey("events");
  const activeIds = await client.lrange(activeKey, 0, -1);
  const recoverable = [];
  const locked = [];
  for (const id of activeIds) {
    if (Number(await client.exists(queue.toKey(`${id}:lock`))) > 0)
      locked.push(id);
    else recoverable.push(id);
  }
  if (locked.length && !clearLocks) {
    throw new Error(
      `Refusing recovery while ${locked.length} active jobs still have locks`,
    );
  }
  if (locked.length) {
    for (const id of locked) {
      await client.del(queue.toKey(`${id}:lock`));
      recoverable.push(id);
    }
  }

  const moveOne = `
    if redis.call('LREM', KEYS[1], 1, ARGV[1]) == 1 then
      redis.call('RPUSH', KEYS[2], ARGV[1])
      redis.call('SREM', KEYS[3], ARGV[1])
      redis.call('XADD', KEYS[4], '*', 'event', 'waiting', 'jobId', ARGV[1], 'prev', 'active')
      return 1
    end
    return 0
  `;
  let moved = 0;
  for (const id of recoverable) {
    moved += Number(
      await client.eval(
        moveOne,
        4,
        activeKey,
        pausedKey,
        stalledKey,
        eventsKey,
        id,
      ),
    );
  }
  console.log(
    JSON.stringify({
      queue: name,
      activeBefore: activeIds.length,
      clearedLocks: locked.length,
      moved,
      counts: await queue.getJobCounts("active", "paused", "delayed"),
    }),
  );
} finally {
  await queue.close();
}
