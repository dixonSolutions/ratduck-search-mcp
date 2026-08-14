#!/usr/bin/env node
// tsc drops the executable bit, so restore it on the built CLI entrypoint.
import { chmodSync, existsSync } from "node:fs";

const target = new URL("../dist/index.js", import.meta.url);
if (existsSync(target)) {
  chmodSync(target, 0o755);
} else {
  console.error("dist/index.js not found — did the build run?");
  process.exit(1);
}
