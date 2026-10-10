import fs from "fs";
import path from "path";
import { applyReplacements } from "./compile.js";
import { TARGET_METADATA, isTarget } from "./targets.js";

export function safeOutputPath(outDir: string, relative: string): string {
	const normalized = relative.replace(/\\/g, "/");
	if (
		!normalized ||
		path.posix.isAbsolute(normalized) ||
		/^[a-z]:/i.test(normalized) ||
		normalized.split("/").includes("..") ||
		normalized.includes("\0")
	)
		throw new Error(`Unsafe output path: ${relative}`);
	const root = path.resolve(outDir);
	const dest = path.resolve(root, normalized);
	if (dest === root || !dest.startsWith(root + path.sep))
		throw new Error(`Unsafe output path: ${relative}`);
	// Existing symlinks must not redirect writes outside the output tree.
	let current = dest;
	while (true) {
		let stat: fs.Stats | undefined;
		try {
			stat = fs.lstatSync(current);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		if (stat?.isSymbolicLink())
			throw new Error(`Symlink in output path: ${current}`);
		if (current === root) break;
		current = path.dirname(current);
	}
	return dest;
}

export class OutputRegistry {
	private destinations = new Map<string, string>();
	private directories = new Map<string, string>();
	constructor(private outDir: string) {}
	claim(relative: string, source: string): string {
		const dest = safeOutputPath(this.outDir, relative);
		const root = path.resolve(this.outDir);
		let owner = this.destinations.get(dest) ?? this.directories.get(dest);
		for (
			let parent = path.dirname(dest);
			parent !== root;
			parent = path.dirname(parent)
		)
			owner ??= this.destinations.get(parent);
		if (owner !== undefined)
			throw new Error(
				`Output collision: ${source} and ${owner} → ${relative}`,
			);
		this.destinations.set(dest, source);
		for (
			let parent = path.dirname(dest);
			parent !== root;
			parent = path.dirname(parent)
		)
			if (!this.directories.has(parent))
				this.directories.set(parent, source);
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		return dest;
	}
}

export function resolveArtifactName(
	template: string,
	config: {
		addonName?: string;
		version?: string;
		addon?: { name?: string; version?: string };
	},
	pkg: string,
): string {
	const target = pkg.toLowerCase();
	const shortPkg = isTarget(target) ? TARGET_METADATA[target].shortName : pkg;
	const safeName = (config.addonName || config.addon?.name || "").replace(
		/\s+/g,
		"-",
	);
	const artifact = applyReplacements(template, [
		{ from: "${addon.name}", to: safeName },
		{
			from: "${addon.version}",
			to: config.version || config.addon?.version || "",
		},
		{ from: "${build.package}", to: shortPkg },
	]);
	validateRelativeArtifact(artifact);
	return artifact;
}

function validateRelativeArtifact(artifact: string): void {
	if (
		!artifact ||
		path.posix.isAbsolute(artifact) ||
		path.win32.isAbsolute(artifact) ||
		/[\\:\x00-\x1f\x7f<>"|?*]/.test(artifact) ||
		artifact
			.split("/")
			.some(
				(part) =>
					!part ||
					part === "." ||
					part === ".." ||
					/[. ]$/.test(part),
			)
	) {
		throw new Error(`Unsafe artifact path: ${JSON.stringify(artifact)}`);
	}
}

export function addonFolderName(name: string, version: string): string {
	const safeName = name.replace(/\s+/g, "-");
	for (const component of [safeName, version]) {
		validateRelativeArtifact(component);
		if (component.includes("/"))
			throw new Error(
				`Unsafe addon folder component: ${JSON.stringify(component)}`,
			);
	}
	return safeName + "_" + version;
}
