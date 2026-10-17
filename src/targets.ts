export const TARGET_METADATA = {
	nextmusic: {
		displayName: "Next Music",
		sourceFolder: "nm",
		shortName: "nm",
		dev: true,
		artifactSections: ["tarGz"],
	},
	web: {
		displayName: "Web",
		sourceFolder: "web",
		shortName: "web",
		dev: false,
		artifactSections: ["userscript", "onefile"],
	},
	bin: {
		displayName: "Module (.bin)",
		sourceFolder: null,
		shortName: "bin",
		dev: true,
		artifactSections: [],
	},
} as const;

export type Target = keyof typeof TARGET_METADATA;

export const TARGETS = Object.keys(TARGET_METADATA) as Target[];

export function isTarget(value: string): value is Target {
	return Object.hasOwn(TARGET_METADATA, value);
}
