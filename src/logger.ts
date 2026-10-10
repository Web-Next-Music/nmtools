import os from "os";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const BLUE = "\x1b[34m";
const GRAY = "\x1b[90m";

export function info(
	msg: string,
	data?: Record<string, unknown> | string,
): void {
	const line = `  ${GREEN}•${RESET} ${BOLD}${msg}${RESET}`;
	if (data !== undefined) {
		const pairs =
			typeof data === "object"
				? Object.entries(data)
						.map(
							([k, v]) =>
								`${CYAN}${k}${RESET}=${GRAY}${v}${RESET}`,
						)
						.join("  ")
				: GRAY + data + RESET;
		process.stdout.write(line + "  " + pairs + os.EOL);
	} else {
		process.stdout.write(line + os.EOL);
	}
}

export function step(msg: string): void {
	process.stdout.write(`${GRAY}  │${RESET}  ${msg}${os.EOL}`);
}

export function header(pkg: string, version?: string): void {
	const line = `${BOLD}${BLUE}nmtools${RESET} ${GRAY}v${version || "1.0.0"}${RESET}`;
	process.stdout.write(os.EOL + line + os.EOL);
}

export function task(name: string): void {
	process.stdout.write(
		`${os.EOL}${GRAY}  ┌─${RESET} ${BOLD}${CYAN}${name}${RESET}${os.EOL}`,
	);
}

export function done(name: string, files?: string): void {
	const fileStr = files ? ` ${GRAY}(${files})${RESET}` : "";
	process.stdout.write(
		`${GRAY}  └─${RESET} ${GREEN}${BOLD}done${RESET}${fileStr}${os.EOL}`,
	);
}

export function artifact(file: string, size?: string): void {
	const sizeStr = size ? ` ${GRAY}${size}${RESET}` : "";
	process.stdout.write(
		`${GRAY}  │${RESET}  ${GREEN}✔${RESET} ${BOLD}${file}${RESET}${sizeStr}${os.EOL}`,
	);
}

export function warn(msg: string): void {
	process.stdout.write(`${YELLOW}  ⨯  ${msg}${RESET}${os.EOL}`);
}

export function error(msg: string): void {
	process.stderr.write(`${RED}  ⨯  ${msg}${RESET}${os.EOL}`);
}

export function file(action: string, name: string): void {
	const icons: Record<string, string> = {
		minify: "~",
		copy: "•",
		write: "•",
		skip: "»",
	};
	const icon = icons[action] || "⤷";
	process.stdout.write(
		`${GRAY}  │${RESET}     ${GRAY}${icon}${RESET} ${name}${os.EOL}`,
	);
}

export default { info, step, header, task, done, artifact, warn, error, file };
