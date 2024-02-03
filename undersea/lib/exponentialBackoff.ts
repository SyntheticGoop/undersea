import { wait } from "./wait";

/**
 * Exponentially backoff a function call until it returns true.
 */
export async function exponentialBackoff(
	call: () => boolean,
	options: { base: number; maxBackoff: number } = {
		base: 2,
		maxBackoff: 10000,
	},
) {
	let backoff = 1;
	let failure = 0;

	while (true) {
		if (call()) return;
		if (backoff === 10000) {
			await wait(backoff);
		} else {
			failure++;

			backoff = Math.min(options.base ** failure, options.maxBackoff);

			await wait(backoff);
		}
	}
}
