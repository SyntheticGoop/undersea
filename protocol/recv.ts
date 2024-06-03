import { match } from "./Protocol";
import type { Socket } from "../lib/Socket";
import type { Task, TaskHandle } from "../lib/Task";
import type { Protocol } from "./Protocol";

/**
 * Receives data on a socket.
 *
 * @param socket Socket to receive data on.
 * @param proto Protocol configuration to match.
 * @param task Task to use for cancellation.
 * @param next Function to call immediately when data is received. You must use this to ensure that the next data is received in a blocking fashion.
 */
export function recv<T = { buffer: ArrayBuffer; proto: Protocol }>(
	socket: Socket,
	{
		filter,
		...proto
	}: Partial<Protocol> & {
		filter?: (data: { buffer: ArrayBuffer; proto: Protocol }) => T | null;
	},
	task: Task,
): TaskHandle<T> {
	return task.wrap((isCancelled, resolve, task) => {
		if (typeof isCancelled() === "string") return () => {};
		socket
			.recv((data) => {
				const matched = match(proto, data);

				if (!matched) return false;

				if (!filter) {
					resolve(matched as T);
					return true;
				}

				const result = filter(matched);

				if (result) {
					resolve(result);
					return true;
				}

				return false;
			}, task)
			// Socket is expected to be dropped here.
			.catch(() => task.cancel("Socket closed"));
	});
}
