import { Atomic } from "../lib/Atomic";
import { recv } from "./recv";
import { send } from "./send";
import { Protocol } from "./Protocol";
import { Socket } from "../lib/Socket";
import { CancellableResult, Task } from "../lib/Task";
import { match, brand } from "./Signal";

/**
 * Listens for contiguous ordered data on a socket, sending an ACK for each message.
 *
 * @param socket Socket to listen on.
 * @param proto Protocol configuration to use.
 * @param task Task to use for the listen.
 * @param atomic Atomic to use for the listen.
 * @param push Function to push data to.
 */

export function listen(
	socket: Socket,
	proto: Omit<Protocol, "type">,
	task: Task,
	atomic: Atomic,
	timeoutMs: number,
	push: (value: CancellableResult<ArrayBuffer>) => void,
) {
	return task.poll(async (task) => {
		if (typeof task.isCancelled() === "string") return null;
		const step = atomic.next;
		const receivingTask = task.subtask().deadline(timeoutMs, "listen");

		const result = recv(
			socket,
			{
				...proto,
				type: "MSG",
				filter: (data) => match(step, data.buffer),
			},
			receivingTask,
		);

		const data = await result;
		receivingTask.cleanup("listen received");

		if (typeof task.isCancelled() === "string") return null;

		if (typeof data.reason === "string") {
			push(data);
			task.cancel(data.reason);
			return null;
		}

		send(
			socket,
			{ ...proto, type: "ACK" },
			brand(step, new Uint8Array(0).buffer),
		);

		push({ value: data.value.buffer });
		return { value: null };
	});
}
