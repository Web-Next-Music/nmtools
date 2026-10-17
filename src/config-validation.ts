import fs from "fs";
import path from "path";
import * as v from "valibot";
import * as log from "./logger.js";
import { isTarget, TARGET_METADATA, TARGETS, type Target } from "./targets.js";
import { addonFolderName, resolveArtifactName } from "./utils.js";

export type UnknownObject = Record<string, unknown>;

export interface PackageIdentity {
	addonName: string;
	version: string;
}

export const objectSchema = (field: string) =>
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

export function parse<
	TSchema extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>,
>(schema: TSchema, value: unknown): v.InferOutput<TSchema> {
	const result = v.safeParse(schema, value);
	if (!result.success) {
		throw new Error(result.issues[0].message);
	}
	return result.output;
}

export function readProject(cwd: string): UnknownObject {
	const packagePath = path.join(cwd, "package.json");
	if (!fs.existsSync(packagePath)) {
		throw new Error(`package.json not found in ${cwd}`);
	}
	return parse(
		objectSchema("package.json"),
		JSON.parse(fs.readFileSync(packagePath, "utf8")),
	);
}

export function resolveTargets(build: UnknownObject): Target[] {
	if (build.package !== undefined) {
		log.warn("build.package is deprecated; use build.targets instead");
	}
	const targets = parse(
		v.array(v.string(), "build.targets must be an array of target names"),
		build.targets ?? build.package ?? [],
	);
	const normalisedTargets = [
		...new Set(targets.map((target) => target.toLowerCase())),
	];
	for (const target of normalisedTargets) {
		if (!isTarget(target)) {
			throw new Error(
				`Unknown target: "${target}". Available: ${TARGETS.join(", ")}`,
			);
		}
	}
	return normalisedTargets as Target[];
}

export function resolveSourceDirectory(
	cwd: string,
	build: UnknownObject,
): string {
	const source = parse(
		safeRelativePathSchema("build.src"),
		build.src ?? "src",
	);
	const sourceDirectory = path.join(cwd, source);
	if (
		!fs.existsSync(sourceDirectory) ||
		!fs.statSync(sourceDirectory).isDirectory()
	) {
		throw new Error(`Source directory not found: ${sourceDirectory}`);
	}
	const physicalSource = fs.realpathSync(sourceDirectory);
	const physicalRelative = path.relative(cwd, physicalSource);
	const escapesProject =
		physicalRelative === ".." ||
		physicalRelative.startsWith(".." + path.sep) ||
		path.isAbsolute(physicalRelative);
	if (escapesProject) {
		throw new Error(
			"build.src must remain inside the project, including symlinks",
		);
	}
	return sourceDirectory;
}

export function resolvePackage(raw: UnknownObject): PackageIdentity {
	const addonName = parse(nonEmptyStringSchema("addonName"), raw.addonName);
	const version = parse(nonEmptyStringSchema("version"), raw.version);
	addonFolderName(addonName, version);
	if (raw.description !== undefined) {
		parse(
			v.union([
				lineStringSchema("description"),
				v.array(lineStringSchema("description")),
			]),
			raw.description,
		);
	}
	if (raw.author !== undefined) {
		parse(
			v.union([
				lineStringSchema("author"),
				v.array(lineStringSchema("author")),
			]),
			raw.author,
		);
	}
	return { addonName, version };
}

function validateUserscript(userscript: unknown): void {
	const section = parse(objectSchema("web.userscript"), userscript);
	const stringFields = new Set([
		"name",
		"namespace",
		"version",
		"description",
		"author",
		"icon",
		"artifactName",
	]);
	for (const [key, value] of Object.entries(section)) {
		if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(key)) {
			throw new Error(`Invalid userscript field: ${key}`);
		}
		if (stringFields.has(key) && typeof value !== "string") {
			throw new Error(`web.userscript.${key} must be a string`);
		}
		parse(
			v.union(
				[v.string(), v.boolean(), v.array(v.string())],
				`web.userscript.${key} must be a string, boolean or string array`,
			),
			value,
		);
		const values = Array.isArray(value) ? value : [value];
		const containsLineBreak = values.some(
			(item) => typeof item === "string" && /[\r\n]/.test(item),
		);
		if (containsLineBreak) {
			throw new Error(
				`web.userscript.${key} must not contain line breaks`,
			);
		}
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

function validateArtifactSections(
	target: Target,
	section: UnknownObject,
	identity: PackageIdentity,
): void {
	for (const key of TARGET_METADATA[target].artifactSections) {
		if (section[key] === undefined) {
			continue;
		}
		const nested = parse(objectSchema(`${target}.${key}`), section[key]);
		if (target === "nextmusic" && nested.artifactName === undefined) {
			throw new Error("nextmusic.tarGz.artifactName is required");
		}
		if (nested.artifactName !== undefined) {
			const artifactName = parse(
				nonEmptyStringSchema(`${target}.${key}.artifactName`),
				nested.artifactName,
			);
			resolveArtifactName(artifactName, identity, target);
		}
	}
}

function validateBinOptions(
	section: UnknownObject,
	identity: PackageIdentity,
): void {
	if (section.artifactName === undefined) {
		return;
	}
	const artifactName = parse(
		nonEmptyStringSchema("bin.artifactName"),
		section.artifactName,
	);
	resolveArtifactName(artifactName, identity, "bin");
}

function validateWebOptions(section: UnknownObject): void {
	if (section.icon !== undefined) {
		parse(v.string("web.icon must be a string"), section.icon);
	}
	if (section.userscript !== undefined) {
		validateUserscript(section.userscript);
	}
	if (section.replaceLink !== undefined) {
		validateReplaceLink(section.replaceLink);
	}
}

export function validateTargetOptions(
	raw: UnknownObject,
	identity: PackageIdentity,
): void {
	for (const target of TARGETS) {
		if (raw[target] === undefined) {
			continue;
		}
		const section = parse(objectSchema(target), raw[target]);
		validateArtifactSections(target, section, identity);
		if (target === "bin") {
			validateBinOptions(section, identity);
		}
		if (target === "web") {
			validateWebOptions(section);
		}
	}
}
