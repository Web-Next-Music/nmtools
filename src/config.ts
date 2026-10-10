import fs from "fs";
import path from "path";
import { createRequire } from "module";
import * as v from "valibot";
import { loadEnvFile } from "./env.js";
import { addonFolderName, resolveArtifactName } from "./utils.js";
import * as log from "./logger.js";
import type { Config, ProjectConfig } from "./types.js";
import { isTarget, TARGETS, TARGET_METADATA, type Target } from "./targets.js";

const _require = createRequire(import.meta.url);

type UnknownObject = Record<string, unknown>;

const objectSchema = (field: string) =>
	v.looseObject({}, `${field} must be an object`);

const nonEmptyStringSchema = (field: string) =>
	v.pipe(
		v.string(
			`${field} must be a non-empty string without control characters`,
		),
		v.check(
			(value) => Boolean(value.trim()) && !/[\x00-\x1f\x7f]/.test(value),
			`${field} must be a non-empty string without control characters`,
		),
	);

const safeRelativePathSchema = (field: string) =>
	v.pipe(
		nonEmptyStringSchema(field),
		v.check(
			(value) =>
				!path.isAbsolute(value) &&
				!/[\\:]/.test(value) &&
				!value
					.split("/")
					.some((part) => !part || part === ".." || part === "."),
			`${field} must be a safe relative path`,
		),
	);

const lineStringSchema = (field: string) =>
	v.pipe(
		v.string(`${field} must contain strings without line breaks`),
		v.check(
			(value) => !/[\r\n]/.test(value),
			`${field} must contain strings without line breaks`,
		),
	);

function parse<
	TSchema extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>,
>(schema: TSchema, value: unknown): v.InferOutput<TSchema> {
	const result = v.safeParse(schema, value);
	if (!result.success) throw new Error(result.issues[0].message);
	return result.output;
}

function readProject(cwd: string): UnknownObject {
	const pkgPath = path.join(cwd, "package.json");
	if (!fs.existsSync(pkgPath))
		throw new Error(`package.json not found in ${cwd}`);
	return parse(
		objectSchema("package.json"),
		JSON.parse(fs.readFileSync(pkgPath, "utf8")),
	);
}

function resolveTargets(build: UnknownObject): Target[] {
	if (build.package !== undefined)
		log.warn("build.package is deprecated; use build.targets instead");
	const targets = parse(
		v.array(v.string(), "build.targets must be an array of target names"),
		build.targets ?? build.package ?? [],
	);
	const normalised = [
		...new Set(targets.map((target) => target.toLowerCase())),
	];
	for (const target of normalised)
		if (!isTarget(target))
			throw new Error(
				`Unknown target: "${target}". Available: ${TARGETS.join(", ")}`,
			);
	return normalised as Target[];
}

function resolveSourceDirectory(cwd: string, build: UnknownObject): string {
	const src = parse(safeRelativePathSchema("build.src"), build.src ?? "src");
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

function resolvePackage(raw: UnknownObject) {
	const addonName = parse(nonEmptyStringSchema("addonName"), raw.addonName);
	const version = parse(nonEmptyStringSchema("version"), raw.version);
	addonFolderName(addonName, version);
	if (raw.description !== undefined)
		parse(
			v.union([
				lineStringSchema("description"),
				v.array(lineStringSchema("description")),
			]),
			raw.description,
		);
	if (raw.author !== undefined)
		parse(
			v.union([
				lineStringSchema("author"),
				v.array(lineStringSchema("author")),
			]),
			raw.author,
		);
	return { addonName, version };
}

function validateUserscript(userscript: unknown): void {
	const section = parse(objectSchema("web.userscript"), userscript);
	for (const [key, value] of Object.entries(section)) {
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
		parse(
			v.union(
				[v.string(), v.boolean(), v.array(v.string())],
				`web.userscript.${key} must be a string, boolean or string array`,
			),
			value,
		);
		const values = Array.isArray(value) ? value : [value];
		if (
			values.some(
				(item) => typeof item === "string" && /[\r\n]/.test(item),
			)
		)
			throw new Error(
				`web.userscript.${key} must not contain line breaks`,
			);
	}
}

function validateReplaceLink(replaceLink: unknown): void {
	const replacements = parse(
		v.array(
			objectSchema("web.replaceLink entry"),
			"web.replaceLink must be an array",
		),
		replaceLink,
	);
	for (const [index, replacement] of replacements.entries()) {
		parse(
			v.looseObject(
				{
					from: nonEmptyStringSchema(
						`web.replaceLink[${index}].from`,
					),
					to: v.optional(
						v.string(
							`web.replaceLink[${index}].to must be a string`,
						),
					),
				},
				`web.replaceLink[${index}] must be an object`,
			),
			replacement,
		);
	}
}

function validateTargetOptions(
	raw: UnknownObject,
	identity: { addonName: string; version: string },
): void {
	for (const target of TARGETS) {
		if (raw[target] === undefined) continue;
		const section = parse(objectSchema(target), raw[target]);
		for (const key of TARGET_METADATA[target].artifactSections) {
			if (section[key] === undefined) continue;
			const nested = parse(
				objectSchema(`${target}.${key}`),
				section[key],
			);
			if (target === "nextmusic" && nested.artifactName === undefined)
				throw new Error("nextmusic.tarGz.artifactName is required");
			if (nested.artifactName !== undefined) {
				const artifactName = parse(
					nonEmptyStringSchema(`${target}.${key}.artifactName`),
					nested.artifactName,
				);
				resolveArtifactName(artifactName, identity, target);
			}
		}
		if (target === "bin" && section.artifactName !== undefined) {
			const artifactName = parse(
				nonEmptyStringSchema("bin.artifactName"),
				section.artifactName,
			);
			resolveArtifactName(artifactName, identity, target);
		}
		if (target === "web") {
			if (section.icon !== undefined)
				parse(v.string("web.icon must be a string"), section.icon);
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
	const build = parse(objectSchema("build"), raw.build);
	const targets = resolveTargets(build);
	const srcDir = resolveSourceDirectory(cwd, build);
	const { addonName, version } = resolvePackage(raw);
	validateTargetOptions(raw, { addonName, version });
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
		_buildIgnore: readBuildIgnore(cwd),
	};
}
