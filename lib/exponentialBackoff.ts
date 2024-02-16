import { wait } from "./wait";

/**
 * Exponentially backoff a function call until it returns true.
 */
export async function exponentialBackoff(
	call: () => boolean,
	options: { base: number; maxBackoff: number; deadline: number } = {
		base: 2,
		maxBackoff: 10000,
		deadline: 0x7fff_ffff,
	},
): Promise<boolean> {
	let backoff = 1;
	let failure = 0;

	let run = true;
	const abortDeadline: {
		timeout?: ReturnType<typeof setTimeout>;
	} = {};

	const abort = wait(options.deadline, abortDeadline).then(
		// biome-ignore lint/suspicious/noAssignInExpressions: <explanation>
		// biome-ignore lint/style/noCommaOperator: <explanation>
		() => ((run = false), true),
	);

	while (run) {
		if (call()) return true;
		if (backoff === 10000) {
			if (await Promise.race([wait(backoff).then(() => false), abort])) break;
		} else {
			failure++;

			backoff = Math.min(options.base ** failure, options.maxBackoff);

			if (await Promise.race([wait(backoff).then(() => false), abort])) break;
		}
	}

	if (typeof abortDeadline.timeout !== "undefined")
		clearTimeout(abortDeadline.timeout);

	return false;
}
