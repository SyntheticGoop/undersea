import { Atomic } from "../lib/Atomic";
import { recv } from "./recv";
import { send } from "./send";
import { Protocol } from "./Protocol";
import { Socket } from "../lib/Socket";
import { Task } from "../lib/Task";
import { match, brand } from "./Signal";

/**
 * Stream data on a socket, expecting an ACK for each message before sending the
 * next.
 *
 * @param socket Socket to stream data on.
 * @param proto Protocol configuration to use.
 * @param task Task to use for the stream.
 * @param atomic Atomic to use for the stream.
 * @param timeoutMs Timeout to use for acks.
 * @param pull Function to pull data from.
 */
export function stream(
	socket: Socket,
	proto: Omit<Protocol, "type">,
	task: Task,
	atomic: Atomic,
	timeoutMs: number,
	pull: () => Promise<ArrayBuffer | null> | null,
) {
	return task.poll(async (task) => {
		const data = await pull();

		if (typeof task.isCancelled() === "string") return false;
		if (data === null) return false;

		const step = atomic.next;

		const ack = recv(
			socket,
			{
				...proto,
				type: "ACK",
				filter: (data) => match(step, data.buffer),
			},
			task.subtask().deadline(timeoutMs, "send ack"),
		);

		send(socket, { ...proto, type: "MSG" }, brand(step, data));

		return ack;
	});
}
