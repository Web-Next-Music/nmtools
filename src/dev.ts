import fs from "fs";
import path from "path";
import { watch, type FSWatcher } from "chokidar";
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
	let watcher: FSWatcher | undefined;
	const configFiles = ["package.json", ".env", ".buildignore"];
	let timer: ReturnType<typeof setTimeout> | undefined;
	let building = false;
	let pending = false;
	let stopped = false;

	async function closeWatcher(): Promise<void> {
		const current = watcher;
		watcher = undefined;
		await current?.close();
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

	async function refreshWatcher(): Promise<void> {
		await closeWatcher();
		const srcDir = config._srcDir;
		watcher = watch(
			[
				...configFiles.map((filename) => path.join(cwd, filename)),
				srcDir,
			],
			{
				ignoreInitial: true,
				ignored: (watchedPath) => {
					const relative = path.relative(srcDir, watchedPath);
					if (relative.startsWith("..") || path.isAbsolute(relative))
						return false;
					const parts = relative.split(path.sep);
					return (
						parts.includes("node_modules") ||
						parts.includes(".git") ||
						(target === "nextmusic" && parts.includes("web"))
					);
				},
			},
		);
		watcher.on("all", requestBuild);
		watcher.on("error", (error) => {
			log.error(`Watcher failed: ${String(error)}`);
			requestBuild();
		});
	}

	async function compile(): Promise<void> {
		const next = loadConfig(cwd);
		if (!next._targets.includes(target))
			throw new Error(
				`Dev target "${target}" was removed from build.targets`,
			);
		config = next;
		await refreshWatcher();
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
		await closeWatcher();
		throw error;
	} finally {
		building = false;
	}
	if (pending && !timer) void drain();

	await new Promise<void>((resolve) => {
		function stop(): void {
			stopped = true;
			if (timer) clearTimeout(timer);
			void closeWatcher().then(resolve);
			process.removeListener("SIGINT", stop);
			process.removeListener("SIGTERM", stop);
			process.stdout.write("\n");
		}
		process.on("SIGINT", stop);
		process.on("SIGTERM", stop);
	});
}
