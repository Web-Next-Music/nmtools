#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);

if (typeof Bun !== "undefined") {
	const { run } = await import("../dist/cli.js");
	run(args).catch((e) => {
		console.error(e);
		process.exit(1);
	});
} else {
	const require = createRequire(import.meta.url);
	let bunExe;
	try {
		bunExe = require.resolve("bun/bin/bun.exe");
	} catch {
		console.error(
			"nmtools requires the Bun runtime, which ships as a dependency.\n" +
				"Reinstall nmtools, or install Bun from https://bun.sh and re-run.",
		);
		process.exit(1);
	}
	const self = fileURLToPath(import.meta.url);
	const { status } = spawnSync(bunExe, [self, ...args], { stdio: "inherit" });
	process.exit(status ?? 1);
}
