import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { loadEnvFile } from "./env.js";
import { addonFolderName, resolveArtifactName } from "./utils.js";
import * as log from "./logger.js";
import type { Config, Metadata, ProjectConfig } from "./types.js";
import { isTarget, TARGETS, TARGET_METADATA, type Target } from "./targets.js";

const _require = createRequire(import.meta.url);

function requireObject(value: unknown, field: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error(`${field} must be an object`);
	return value as Record<string, unknown>;
}

function assertNonEmptyString(
	value: unknown,
	field: string,
): asserts value is string {
	if (
		typeof value !== "string" ||
		!value.trim() ||
		/[\x00-\x1f\x7f]/.test(value)
	)
		throw new Error(
			`${field} must be a non-empty string without control characters`,
		);
}

function assertSafeRelativePath(
	value: unknown,
	field: string,
): asserts value is string {
	assertNonEmptyString(value, field);
	if (
		path.isAbsolute(value) ||
		/[\\:]/.test(value) ||
		value.split("/").some((part) => !part || part === ".." || part === ".")
	)
		throw new Error(`${field} must be a safe relative path`);
}

function readProject(cwd: string): Record<string, unknown> {
	const pkgPath = path.join(cwd, "package.json");
	if (!fs.existsSync(pkgPath))
		throw new Error(`package.json not found in ${cwd}`);
	const raw = requireObject(
		JSON.parse(fs.readFileSync(pkgPath, "utf8")),
		"package.json",
	);
	return raw;
}

function resolveTargets(build: Record<string, unknown>): Target[] {
	if (build.package !== undefined)
		log.warn("build.package is deprecated; use build.targets instead");
	const targets = build.targets ?? build.package ?? [];
	if (
		!Array.isArray(targets) ||
		targets.some((target) => typeof target !== "string")
	)
		throw new Error("build.targets must be an array of target names");
	const normalised = [
		...new Set(targets.map((target: string) => target.toLowerCase())),
	];
	for (const target of normalised)
		if (!isTarget(target))
			throw new Error(
				`Unknown target: "${target}". Available: ${TARGETS.join(", ")}`,
			);

	return normalised as Target[];
}

function resolveSourceDirectory(
	cwd: string,
	build: Record<string, unknown>,
): string {
	const src = build.src ?? "src";
	assertSafeRelativePath(src, "build.src");
	const srcDir = path.join(cwd, src);
	if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory())
		throw new Error(`Source directory not found: ${srcDir}`);
	const physicalSrc = fs.realpathSync(srcDir);
	const physicalRelative = path.relative(cwd, physicalSrc);
	if (
		physicalRelative === ".." ||
		physicalRelative.startsWith(".." + path.sep) ||
		path.isAbsolute(physicalRelative)
	)
		throw new Error(
			"build.src must remain inside the project, including symlinks",
		);
	return srcDir;
}

function resolveMetadata(srcDir: string, raw: Record<string, unknown>) {
	const metaPath = path.join(srcDir, "metadata.json");
	const metadata = fs.existsSync(metaPath)
		? requireObject(
				JSON.parse(fs.readFileSync(metaPath, "utf8")),
				"metadata.json",
			)
		: null;
	const addonName = metadata?.name ?? raw.addonName;
	const version = metadata?.version ?? raw.version;
	assertNonEmptyString(addonName, "addonName (or metadata.name)");
	assertNonEmptyString(version, "version (or metadata.version)");
	addonFolderName(addonName, version);
	for (const field of ["script", "css"])
		if (metadata?.[field] !== undefined)
			assertSafeRelativePath(metadata[field], `metadata.${field}`);
	for (const field of ["description", "type"])
		if (
			metadata?.[field] !== undefined &&
			typeof metadata[field] !== "string"
		)
			throw new Error(`metadata.${field} must be a string`);
	if (
		metadata?.author !== undefined &&
		typeof metadata.author !== "string" &&
		(!Array.isArray(metadata.author) ||
			metadata.author.some((author) => typeof author !== "string"))
	)
		throw new Error(
			"metadata.author must be a string or an array of strings",
		);

	for (const [field, value] of Object.entries({
		description: raw.description,
		author: raw.author,
		"metadata.description": metadata?.description,
		"metadata.author": metadata?.author,
	})) {
		if (value === undefined) continue;
		const values = Array.isArray(value) ? value : [value];
		if (
			values.some(
				(item) => typeof item !== "string" || /[\r\n]/.test(item),
			)
		)
			throw new Error(
				`${field} must contain strings without line breaks`,
			);
	}
	return { addonName, version, metadata: metadata as Metadata | null };
}

function validateUserscript(userscript: unknown): void {
	for (const [key, value] of Object.entries(
		requireObject(userscript, "web.userscript"),
	)) {
		if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(key))
			throw new Error(`Invalid userscript field: ${key}`);
		if (
			[
				"name",
				"namespace",
				"version",
				"description",
				"author",
				"icon",
				"artifactName",
			].includes(key) &&
			typeof value !== "string"
		)
			throw new Error(`web.userscript.${key} must be a string`);
		if (
			typeof value !== "string" &&
			typeof value !== "boolean" &&
			(!Array.isArray(value) ||
				value.some((item) => typeof item !== "string"))
		)
			throw new Error(
				`web.userscript.${key} must be a string, boolean or string array`,
			);
		if (
			(typeof value === "string" && /[\r\n]/.test(value)) ||
			(Array.isArray(value) && value.some((item) => /[\r\n]/.test(item)))
		)
			throw new Error(
				`web.userscript.${key} must not contain line breaks`,
			);
	}
}

function validateReplaceLink(replaceLink: unknown): void {
	if (!Array.isArray(replaceLink))
		throw new Error("web.replaceLink must be an array");
	for (const [index, value] of replaceLink.entries()) {
		const replacement = requireObject(value, `web.replaceLink[${index}]`);
		assertNonEmptyString(
			replacement.from,
			`web.replaceLink[${index}].from`,
		);
		if (replacement.to !== undefined && typeof replacement.to !== "string")
			throw new Error(`web.replaceLink[${index}].to must be a string`);
	}
}

function validateTargetOptions(
	raw: Record<string, unknown>,
	identity: { addonName: string; version: string },
): void {
	for (const target of TARGETS) {
		if (raw[target] === undefined) continue;
		const section = requireObject(raw[target], target);
		const sections = TARGET_METADATA[target].artifactSections;
		for (const key of sections) {
			if (section[key] === undefined) continue;
			const nested = requireObject(section[key], `${target}.${key}`);
			if (target === "nextmusic" && nested.artifactName === undefined)
				throw new Error("nextmusic.tarGz.artifactName is required");
			if (nested.artifactName !== undefined) {
				assertNonEmptyString(
					nested.artifactName,
					`${target}.${key}.artifactName`,
				);
				resolveArtifactName(nested.artifactName, identity, target);
			}
		}
		if (target === "bin" && section.artifactName !== undefined) {
			assertNonEmptyString(section.artifactName, "bin.artifactName");
			resolveArtifactName(section.artifactName, identity, target);
		}
		if (target === "web") {
			if (section.icon !== undefined && typeof section.icon !== "string")
				throw new Error("web.icon must be a string");
			if (section.userscript !== undefined)
				validateUserscript(section.userscript);
			if (section.replaceLink !== undefined)
				validateReplaceLink(section.replaceLink);
		}
	}
}

function readBuildIgnore(cwd: string): string {
	const ignorePath = path.join(cwd, ".buildignore");
	return fs.existsSync(ignorePath) ? fs.readFileSync(ignorePath, "utf8") : "";
}

export function loadConfig(cwd = process.cwd()): Config {
	cwd = fs.realpathSync(path.resolve(cwd));
	const raw = readProject(cwd);
	const build = requireObject(raw.build, "build");
	const targets = resolveTargets(build);
	const srcDir = resolveSourceDirectory(cwd, build);
	const { addonName, version, metadata } = resolveMetadata(srcDir, raw);
	validateTargetOptions(raw, { addonName, version });

	// Only project fields are asserted after validation; resolved fields are explicit.
	const project = { ...raw, build } as ProjectConfig;
	return {
		...project,
		addonName,
		version,
		_targets: targets,
		_cwd: cwd,
		_env: loadEnvFile(cwd),
		_version: (_require("../package.json") as { version: string }).version,
		_srcDir: srcDir,
		_metadata: metadata,
		_buildIgnore: readBuildIgnore(cwd),
	};
}
