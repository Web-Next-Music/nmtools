import fs from "fs";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import {
	cacheStyle,
	contentHash,
	getCachedStyle,
	type StyleCacheEntry,
} from "./style-cache.js";
import type { Replacement } from "./types.js";

const _require = createRequire(import.meta.url);
let _sass: typeof import("sass") | null = null;

function getSass(): typeof import("sass") {
	if (!_sass) {
		try {
			_sass = _require("sass") as typeof import("sass");
		} catch {
			throw new Error("sass is not installed. Run: npm install sass");
		}
	}
	return _sass;
}
export const SCRIPT_EXTS = [".js", ".ts", ".jsx", ".tsx"];

export function isTypeDeclaration(file: string): boolean {
	return file.toLowerCase().endsWith(".d.ts");
}

export function isScriptFile(file: string): boolean {
	const ext = path.extname(file).toLowerCase();
	return SCRIPT_EXTS.includes(ext) && !isTypeDeclaration(file);
}

const JSX_BUILD = {
	runtime: "classic",
	factory: "React.createElement",
	fragment: "React.Fragment",
} as const;
// Create a temp dir, run `fn` with it, always clean up afterwards.
async function withTmpDir<T>(fn: (root: string) => Promise<T>): Promise<T> {
	const os = _require("os") as typeof import("os");
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "nmtools-"));
	try {
		return await fn(root);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
}

async function runBunBuild(
	options: Parameters<typeof Bun.build>[0],
): Promise<Awaited<ReturnType<typeof Bun.build>>> {
	try {
		return await Bun.build(options);
	} catch (error) {
		const details =
			error instanceof AggregateError
				? error.errors.map(String).join("\n")
				: String(error);
		throw new Error(`Bun.build failed:\n${details}`, { cause: error });
	}
}

// Read the single output of a Bun.build result, throwing on failure.
async function bunBuildText(
	result: Awaited<ReturnType<typeof Bun.build>>,
): Promise<string> {
	if (!result.success) {
		throw new Error(
			"Bun.build failed:\n" +
				result.logs.map((logEntry) => String(logEntry)).join("\n"),
		);
	}
	return (await result.outputs[0].text()).trim();
}

export type SourcePolicy = {
	srcDir: string;
	allowedFiles: readonly string[];
};

function createSourceGuard(policy?: SourcePolicy): (file: string) => void {
	if (!policy) {
		return () => {};
	}
	const root = path.resolve(policy.srcDir);
	const realRoot = fs.realpathSync(root);
	const allowed = new Set(
		policy.allowedFiles.map((file) => path.resolve(file)),
	);
	const realAllowed = new Set<string>();
	for (const file of allowed) {
		try {
			realAllowed.add(fs.realpathSync(file));
		} catch {
			/* Missing files are not loadable. */
		}
	}
	const withinSource = (base: string, file: string) => {
		const relative = path.relative(base, file);
		return (
			relative !== ".." &&
			!relative.startsWith(".." + path.sep) &&
			!path.isAbsolute(relative) &&
			!relative.split(path.sep).includes("node_modules")
		);
	};
	return (file) => {
		const absolute = path.resolve(file);
		const real = fs.realpathSync(absolute);
		const resolvesInsideLogicalRoot = withinSource(root, absolute);
		const resolvesInsidePhysicalRoot = withinSource(realRoot, real);
		const isDeclaredLogicalFile = allowed.has(absolute);
		const isDeclaredPhysicalFile = realAllowed.has(real);
		const isDenied =
			(resolvesInsideLogicalRoot && !isDeclaredLogicalFile) ||
			(resolvesInsidePhysicalRoot && !isDeclaredPhysicalFile);

		if (isDenied) {
			throw new Error(`Source policy denied import: ${absolute}`);
		}
	};
}

function splitScriptReplacements(replacements: Replacement[]) {
	const define: Record<string, string> = {};
	const textReplacements: Replacement[] = [];
	for (const replacement of replacements) {
		if (replacement.to === undefined) {
			continue;
		}
		if (/^process\.env\.[A-Za-z_$][A-Za-z0-9_$]*$/.test(replacement.from)) {
			define[replacement.from] = replacement.to;
		} else {
			textReplacements.push(replacement);
		}
	}
	return { define, textReplacements };
}

export function applyScriptReplacements(
	content: string,
	replacements: Replacement[] = [],
): string {
	const { define, textReplacements } = splitScriptReplacements(replacements);
	const code = applyReplacements(content, textReplacements);
	if (!Object.keys(define).length) {
		return code;
	}
	return new Bun.Transpiler({ loader: "js", define }).transformSync(code);
}

export async function compileSCSS(
	src: string,
	content?: string,
	policy?: SourcePolicy,
): Promise<string> {
	const absoluteSrc = path.resolve(src);
	const checkSource = createSourceGuard(policy);
	checkSource(absoluteSrc);
	const code = content ?? fs.readFileSync(absoluteSrc, "utf8");
	const sass = getSass();
	const key = contentHash(
		JSON.stringify([
			"scss",
			absoluteSrc,
			code,
			"compressed",
			content === undefined ? "file" : "string",
			sass.info,
		]),
	);
	// Import resolution can change when a new file appears. Only cache sources
	// without dependency directives (or escapes that could disguise them).
	const cacheable =
		!/@(?:use|forward|import)\b/i.test(code) && !code.includes("\\");
	if (cacheable) {
		const cached = getCachedStyle(key);
		if (cached !== undefined) {
			return cached;
		}
	}
	const result =
		content !== undefined
			? sass.compileString(code, {
					style: "compressed",
					url: pathToFileURL(absoluteSrc),
				})
			: sass.compile(absoluteSrc, { style: "compressed" });
	if (policy) {
		for (const url of result.loadedUrls as URL[]) {
			if (url.protocol !== "file:") {
				throw new Error(
					`Source policy cannot validate SCSS dependency: ${url}`,
				);
			}
			checkSource(fileURLToPath(url));
		}
	}
	const css = (result.css as string).trim();
	if (cacheable && Array.isArray(result.loadedUrls)) {
		try {
			const dependencies: StyleCacheEntry["dependencies"] = [];
			for (const url of result.loadedUrls as URL[]) {
				if (url.protocol !== "file:") {
					return css;
				}
				const file = fileURLToPath(url);
				dependencies.push({
					file,
					hash: contentHash(fs.readFileSync(file)),
				});
			}
			cacheStyle(key, css, dependencies);
		} catch {
			// Unreadable or nonstandard dependencies must not enter the cache.
		}
	}
	return css;
}

export async function minifyCSS(
	src: string,
	content?: string,
): Promise<string> {
	const absoluteSrc = path.resolve(src);
	const code = content ?? fs.readFileSync(absoluteSrc, "utf8");
	const key = contentHash(
		JSON.stringify(["css", absoluteSrc, code, true, ["*"], Bun.version]),
	);
	const cached = getCachedStyle(key);
	if (cached !== undefined) {
		return cached;
	}
	const css = await bunBuildText(
		await runBunBuild({
			entrypoints: [absoluteSrc],
			minify: true,
			external: ["*"],
			plugins: [
				{
					name: "nmtools-css-content",
					setup(build) {
						build.onLoad({ filter: /./ }, (args) => {
							if (args.path === absoluteSrc) {
								return { contents: code, loader: "css" };
							}
						});
					},
				},
			],
		}),
	);
	cacheStyle(key, css);
	return css;
}

export async function bundleJS(
	files: string[],
	replacements: Replacement[] = [],
	isDev = false,
	policy?: SourcePolicy,
): Promise<string> {
	if (files.length === 0) {
		return "";
	}

	const checkSource = createSourceGuard(policy);
	for (const file of files) {
		checkSource(file);
	}
	const { define, textReplacements } = splitScriptReplacements(replacements);

	return withTmpDir(async (root) => {
		const entryContents = files
			.map((file) => `import ${JSON.stringify(path.resolve(file))};`)
			.join("\n");
		const entryFile = path.join(root, "__nmtools_entry.js");
		fs.writeFileSync(entryFile, entryContents, "utf8");

		return bunBuildText(
			await runBunBuild({
				entrypoints: [entryFile],
				format: "iife",
				minify: !isDev,
				jsx: JSX_BUILD,
				define,
				plugins: [
					{
						name: "nmtools-source-replacements",
						setup(build) {
							build.onLoad({ filter: /./ }, async (args) => {
								if (args.path === entryFile) {
									return;
								}
								checkSource(args.path);
								if (
									!/\.(?:[cm]?[jt]s|[jt]sx)$/.test(args.path)
								) {
									return;
								}
								const ext = path.extname(args.path).slice(1);
								const loader =
									ext === "jsx" || ext === "tsx"
										? ext
										: ext.endsWith("ts")
											? "ts"
											: "js";
								return {
									contents: applyReplacements(
										await fs.promises.readFile(
											args.path,
											"utf8",
										),
										textReplacements,
									),
									loader,
								};
							});
						},
					},
				],
			}),
		);
	});
}

export function applyReplacements(
	content: string,
	replacements: Replacement[] = [],
): string {
	for (const { from, to } of replacements) {
		if (!from || to === undefined) {
			continue;
		}
		const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		content = content.replace(new RegExp(escaped, "g"), () => to);
	}
	return content;
}
