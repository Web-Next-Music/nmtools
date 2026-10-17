#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const cli = new URL("../dist/cli.js", import.meta.url);
if (!existsSync(fileURLToPath(cli))) {
	console.error(
		"nmtools CLI is not built. Run pnpm run build in the nmtools repository, or reinstall the published package.",
	);
	process.exit(1);
}

if (typeof Bun !== "undefined") {
	try {
		const { run } = await import(cli.href);
		await run(args);
	} catch (error) {
		console.error(error);
		process.exitCode = 1;
	}
} else {
	const require = createRequire(import.meta.url);
	const candidates = [];
	try {
		candidates.push(require.resolve("bun/bin/bun.exe"));
	} catch {
		// A system Bun installation can run the CLI without the npm binary.
	}
	candidates.push("bun");
	const bunExe = candidates.find((candidate) => {
		const result = spawnSync(candidate, ["--version"], {
			encoding: "utf8",
			timeout: 10000,
		});
		return !result.error && result.status === 0;
	});
	if (!bunExe) {
		console.error(
			"nmtools requires Bun. Allow the bun install script and reinstall dependencies, or install Bun from https://bun.sh and add it to PATH.",
		);
		process.exit(1);
	}
	const result = spawnSync(
		bunExe,
		[fileURLToPath(import.meta.url), ...args],
		{ stdio: "inherit" },
	);
	if (result.error)
		console.error(`Failed to start Bun: ${result.error.message}`);
	if (result.signal)
		console.error(`Bun terminated by signal ${result.signal}`);
	process.exit(result.status ?? 1);
}
