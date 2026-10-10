import fs from "fs";
import path from "path";
import * as log from "./logger.js";
import { loadConfig } from "./config.js";
import { buildDevTarget } from "./builder.js";

const TARGET_DISPLAY: Record<string, string> = {
	nextmusic: "Next Music",
	bin: "Module (.bin)",
};

function displayName(target: string): string {
	return TARGET_DISPLAY[target] ?? target;
}

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const CLEAR_LINE = "\x1b[2K\x1b[1G";

function prompt(question: string, choices: string[]): Promise<string> {
	if (!process.stdin.isTTY)
		return Promise.reject(
			new Error(
				"Specify a dev target when stdin is not a terminal: nmtools dev nextmusic",
			),
		);
	return new Promise((resolve) => {
		let selected = 0;
		let drawn = false;

		function render(): void {
			if (drawn) {
				process.stdout.write(`\x1b[${choices.length}A`);
			}
			drawn = true;

			for (let i = 0; i < choices.length; i++) {
				const label = displayName(choices[i]);
				if (i === selected) {
					process.stdout.write(
						`${CLEAR_LINE}  ${CYAN}> ${label}${RESET}\n`,
					);
				} else {
					process.stdout.write(`${CLEAR_LINE}    ${label}\n`);
				}
			}
		}

		process.stdout.write(`\n  ${question}\n\n`);
		render();

		const stdin = process.stdin;
		stdin.setRawMode(true);
		stdin.resume();
		stdin.setEncoding("utf8");

		function cleanup(): void {
			stdin.setRawMode(false);
			stdin.pause();
			stdin.removeListener("data", onData);
		}

		function onData(key: string): void {
			if (key === "\u0003") {
				cleanup();
				process.stdout.write("\n");
				process.exit(0);
			}

			if (key === "\r" || key === "\n") {
				cleanup();
				process.stdout.write("\n");
				resolve(choices[selected]);
				return;
			}

			if (key === "\x1b[A") {
				selected = (selected - 1 + choices.length) % choices.length;
				render();
				return;
			}

			if (key === "\x1b[B") {
				selected = (selected + 1) % choices.length;
				render();
				return;
			}
		}

		stdin.on("data", onData);
	});
}

export async function runDev(cliTarget?: string): Promise<void> {
	const cwd = fs.realpathSync(process.cwd());
	let config = loadConfig(cwd);
	const available = config._targets.filter(
		(target) => target === "nextmusic" || target === "bin",
	);
	if (!available.length)
		throw new Error(
			'No dev-compatible targets found. Add "nextmusic" or "bin" to build.targets.',
		);
	const target =
		cliTarget?.toLowerCase() ??
		(available.length === 1
			? available[0]
			: await prompt("Select build target:", available));
	if (!available.some((value) => value === target))
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
