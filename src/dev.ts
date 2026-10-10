import fs from "fs";
import path from "path";
import * as log from "./logger.js";
import { loadConfig } from "./config.js";
import { buildDevTarget } from "./builder.js";
import { prompt } from "./prompt.js";
import { TARGET_METADATA, isTarget, type Target } from "./targets.js";

function displayName(target: Target): string {
	return TARGET_METADATA[target].displayName;
}

export async function runDev(cliTarget?: string): Promise<void> {
	const cwd = fs.realpathSync(process.cwd());
	let config = loadConfig(cwd);
	const available = config._targets.filter(
		(target) => TARGET_METADATA[target].dev,
	);
	if (!available.length)
		throw new Error(
			'No dev-compatible targets found. Add "nextmusic" or "bin" to build.targets.',
		);
	const target =
		cliTarget?.toLowerCase() ??
		(available.length === 1
			? available[0]
			: await prompt("Select build target:", available, displayName));
	if (!isTarget(target) || !available.includes(target))
		throw new Error(
			`Dev target "${target}" is not enabled. Available: ${available.join(", ")}`,
		);

	log.header("nmtools", config._version);
	process.stdout.write(
		`  target  ${displayName(target)}  •  ${config.addonName}\n\n`,
	);
	const watchers: fs.FSWatcher[] = [];
	const configFiles = new Set(["package.json", ".env", ".buildignore"]);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let building = false;
	let pending = false;
	let stopped = false;

	function closeWatchers(): void {
		for (const watcher of watchers) watcher.close();
		watchers.length = 0;
	}

	function requestBuild(): void {
		if (stopped) return;
		pending = true;
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = undefined;
			void drain();
		}, 150);
	}

	function sourceChanged(filename: string | null): void {
		if (filename) {
			const parts = filename.replace(/\\/g, "/").split("/");
			if (
				parts.some((part) => part === "node_modules" || part === ".git")
			)
				return;
			if (target === "nextmusic" && parts.includes("web")) return;
		}
		requestBuild();
	}

	function addWatcher(
		dir: string,
		recursive: boolean,
		callback: (filename: string | null) => void,
	): void {
		const watcher = fs.watch(dir, { recursive }, (_event, filename) =>
			callback(filename),
		);
		watcher.on("error", (error) => {
			log.error(`Watcher failed for ${dir}: ${error.message}`);
			requestBuild();
		});
		watchers.push(watcher);
	}

	function fallback(dir: string): void {
		addWatcher(dir, false, sourceChanged);
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			if (
				!entry.isDirectory() ||
				entry.name === "node_modules" ||
				entry.name === ".git"
			)
				continue;
			if (target === "nextmusic" && entry.name === "web") continue;
			fallback(path.join(dir, entry.name));
		}
	}

	function refreshWatchers(): void {
		closeWatchers();
		addWatcher(cwd, false, (filename) => {
			if (
				!filename ||
				configFiles.has(filename) ||
				filename ===
					path.relative(cwd, config._srcDir).split(path.sep)[0]
			)
				requestBuild();
		});
		if (!fs.existsSync(config._srcDir)) return;
		try {
			addWatcher(config._srcDir, true, sourceChanged);
		} catch {
			fallback(config._srcDir);
		}
	}

	async function compile(): Promise<void> {
		const next = loadConfig(cwd);
		if (!next._targets.includes(target))
			throw new Error(
				`Dev target "${target}" was removed from build.targets`,
			);
		config = next;
		refreshWatchers();
		process.stdout.write("  compiling...");
		const start = Date.now();
		try {
			await buildDevTarget(config, target);
			process.stdout.write(
				`\r  compiled in ${((Date.now() - start) / 1000).toFixed(2)}s    \n`,
			);
		} catch (error) {
			process.stdout.write("\r  failed           \n");
			throw error;
		}
	}

	async function drain(): Promise<void> {
		if (building || stopped) return;
		building = true;
		try {
			while (pending && !stopped) {
				pending = false;
				try {
					await compile();
				} catch (error) {
					log.error(`Build failed: ${(error as Error).message}`);
				}
				if (timer) break;
			}
		} finally {
			building = false;
			if (pending && !timer && !stopped) void drain();
		}
	}

	building = true;
	try {
		await compile();
	} catch (error) {
		stopped = true;
		if (timer) clearTimeout(timer);
		closeWatchers();
		throw error;
	} finally {
		building = false;
	}
	if (pending && !timer) void drain();

	await new Promise<void>((resolve) => {
		function stop(): void {
			stopped = true;
			if (timer) clearTimeout(timer);
			closeWatchers();
			process.removeListener("SIGINT", stop);
			process.removeListener("SIGTERM", stop);
			process.stdout.write("\n");
			resolve();
		}
		process.on("SIGINT", stop);
		process.on("SIGTERM", stop);
	});
}
