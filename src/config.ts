import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { loadEnvFile } from "./env.js";
import { addonFolderName, resolveArtifactName } from "./utils.js";
import * as log from "./logger.js";
import type { Config, Metadata } from "./types.js";

const _require = createRequire(import.meta.url);
const TARGETS = new Set(["nextmusic", "web", "bin"]);

function object(value: unknown, field: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error(`${field} must be an object`);
	return value as Record<string, unknown>;
}

function string(value: unknown, field: string): asserts value is string {
	if (
		typeof value !== "string" ||
		!value.trim() ||
		/[\x00-\x1f\x7f]/.test(value)
	)
		throw new Error(
			`${field} must be a non-empty string without control characters`,
		);
}

function relativePath(value: unknown, field: string): asserts value is string {
	string(value, field);
	if (
		path.isAbsolute(value) ||
		/[\\:]/.test(value) ||
		value.split("/").some((part) => !part || part === ".." || part === ".")
	)
		throw new Error(`${field} must be a safe relative path`);
}

export function loadConfig(cwd = process.cwd()): Config {
	cwd = fs.realpathSync(path.resolve(cwd));
	const pkgPath = path.join(cwd, "package.json");
	if (!fs.existsSync(pkgPath))
		throw new Error(`package.json not found in ${cwd}`);
	const raw = object(
		JSON.parse(fs.readFileSync(pkgPath, "utf8")),
		"package.json",
	);
	const build = object(raw.build, "build");
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
		if (!TARGETS.has(target))
			throw new Error(
				`Unknown target: "${target}". Available: ${[...TARGETS].join(", ")}`,
			);

	const src = build.src ?? "src";
	relativePath(src, "build.src");
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
	const metaPath = path.join(srcDir, "metadata.json");
	const metadata = fs.existsSync(metaPath)
		? object(JSON.parse(fs.readFileSync(metaPath, "utf8")), "metadata.json")
		: null;
	const addonName = metadata?.name ?? raw.addonName;
	const version = metadata?.version ?? raw.version;
	string(addonName, "addonName (or metadata.name)");
	string(version, "version (or metadata.version)");
	addonFolderName(addonName, version);
	for (const field of ["script", "css"])
		if (metadata?.[field] !== undefined)
			relativePath(metadata[field], `metadata.${field}`);
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
	const pkg = raw as unknown as Config;
	pkg.addonName = addonName;
	pkg.version = version;
	for (const target of ["nextmusic", "web", "bin"] as const) {
		if (raw[target] === undefined) continue;
		const section = object(raw[target], target);
		const sections =
			target === "nextmusic"
				? ["tarGz"]
				: target === "web"
					? ["userscript", "onefile"]
					: [];
		for (const key of sections) {
			if (section[key] === undefined) continue;
			const nested = object(section[key], `${target}.${key}`);
			if (target === "nextmusic" && nested.artifactName === undefined)
				throw new Error("nextmusic.tarGz.artifactName is required");
			if (nested.artifactName !== undefined) {
				string(nested.artifactName, `${target}.${key}.artifactName`);
				resolveArtifactName(nested.artifactName, pkg, target);
			}
		}
		if (target === "bin" && section.artifactName !== undefined) {
			string(section.artifactName, "bin.artifactName");
			resolveArtifactName(section.artifactName, pkg, target);
		}
		if (target === "web") {
			if (section.icon !== undefined && typeof section.icon !== "string")
				throw new Error("web.icon must be a string");
			if (section.userscript !== undefined) {
				for (const [key, value] of Object.entries(
					object(section.userscript, "web.userscript"),
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
						throw new Error(
							`web.userscript.${key} must be a string`,
						);
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
						(Array.isArray(value) &&
							value.some((item) => /[\r\n]/.test(item)))
					)
						throw new Error(
							`web.userscript.${key} must not contain line breaks`,
						);
				}
			}
			if (section.replaceLink !== undefined) {
				if (!Array.isArray(section.replaceLink))
					throw new Error("web.replaceLink must be an array");
				for (const [index, value] of section.replaceLink.entries()) {
					const replacement = object(
						value,
						`web.replaceLink[${index}]`,
					);
					string(replacement.from, `web.replaceLink[${index}].from`);
					if (
						replacement.to !== undefined &&
						typeof replacement.to !== "string"
					)
						throw new Error(
							`web.replaceLink[${index}].to must be a string`,
						);
				}
			}
		}
	}

	pkg._targets = normalised;
	pkg._cwd = cwd;
	pkg._env = loadEnvFile(cwd);
	pkg._version = (_require("../package.json") as { version: string }).version;
	pkg._srcDir = srcDir;
	pkg._metadata = metadata as Metadata | null;
	const ignorePath = path.join(cwd, ".buildignore");
	pkg._buildIgnore = fs.existsSync(ignorePath)
		? fs.readFileSync(ignorePath, "utf8")
		: "";
	return pkg;
}
