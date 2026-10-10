import ignore from "ignore";

export function parseBuildIgnore(raw = ""): string[] {
	return raw
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith("#"));
}

export function shouldIgnore(diskPath: string, rules: string[]): boolean {
	if (!rules || rules.length === 0) return false;

	const matcher = ignore().add(rules);
	const parts = diskPath
		.replace(/\\/g, "/")
		.replace(/^[A-Za-z]:/, "")
		.split("/")
		.filter(Boolean);

	for (let index = 0; index < parts.length; index++) {
		if (matcher.ignores(parts.slice(index).join("/"))) return true;
	}
	return false;
}
