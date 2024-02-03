import { Atomic } from "../lib/Atomic";
import { recv } from "./recv";
import { send } from "./send";
import { Protocol } from "./Protocol";
import { Socket } from "../lib/Socket";
import { CancellableResult, Task } from "../lib/Task";
import { stream } from "./stream";
import { listen } from "./listen";
import { match, SIGNAL, brand } from "./Signal";

export function connect(
	socket: Socket,
	proto: Omit<Protocol, "type">,
	task: Task,
	sendTimeoutMs: number,
	recvTimeoutMs: number,
	pull: () => Promise<ArrayBuffer | null> | null,
	push: (value: CancellableResult<ArrayBuffer>) => void,
) {
	const sendAtomic = new Atomic(4294967295);
	const initStep = sendAtomic.next;

	const sigHandle = recv(
		socket,
		{ ...proto, type: "ACK", filter: (data) => match(initStep, data.buffer) },
		task.subtask(),
	);
	send(
		socket,
		{ ...proto, type: "SIG" },
		brand(initStep, new Uint8Array([SIGNAL.INIT]).buffer),
	);

	sigHandle.deadline(sendTimeoutMs, "sig init").then(async (estab) => {
		if (typeof estab.reason === "string") {
			task.cancel(estab.reason);
			return estab;
		}

		const recvAtomic = sendAtomic.clone();
		const listenSocket = socket.multiplex();
		listen(listenSocket, proto, task, recvAtomic, recvTimeoutMs, push);

		const streamHandle = stream(
			socket,
			proto,
			task,
			sendAtomic,
			sendTimeoutMs,
			pull,
		);

		await streamHandle.then(() => task.cleanup("connect stream finished"));

		await task.subtask().then(() => {
			send(
				socket,
				{ ...proto, type: "SIG" },
				brand(sendAtomic.next, new Uint8Array([SIGNAL.TERM]).buffer),
			);

			listenSocket.drop();
			socket.drop();
		});
	});

	return task;
}
