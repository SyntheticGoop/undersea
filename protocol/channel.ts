import { Atomic } from "../lib/Atomic";
import { recv } from "./recv";
import { send } from "./send";
import type { Protocol } from "./Protocol";
import type { Socket } from "../lib/Socket";
import type { CancellableResult, Task } from "../lib/Task";
import { stream } from "./stream";
import { listen } from "./listen";
import { match, SIGNAL, brand } from "./Signal";

export function channel(
	socket: Socket,
	proto: Omit<Protocol, "type" | "nonce">,
	task: Task,
	sendTimeoutMs: number,
	recvTimeoutMs: number,
	createHandle: (task: Task) => {
		pull: () => Promise<ArrayBuffer | null> | null;
		push: (value: CancellableResult<ArrayBuffer>) => void;
	},
) {
	task.poll((parentTask) => {
		const task = parentTask.subtask();
		const sessionSocket = socket.multiplex();
		const { pull, push } = createHandle(task);
		const sendAtomic = new Atomic(0xffff);
		const initStep = sendAtomic.next;

		const sigHandle = recv(
			sessionSocket,
			{
				...proto,
				type: "SIG",
				filter: ({ buffer, proto }) => {
					const result = match(initStep, buffer);
					if (!result) return null;

					if (result.buffer.byteLength !== 1) return null;
					if (new DataView(result.buffer).getUint8(0) !== SIGNAL.INIT)
						return null;

					return { ...result, nonce: proto.nonce };
				},
			},
			task.subtask(),
		);

		sigHandle.deadline(recvTimeoutMs, "sig init").then((estab) => {
			if (typeof estab.reason === "string") {
				task.cancel(estab.reason);
				return estab;
			}
			const nonce = estab.value.nonce;

			const termSocket = socket.multiplex();
			const term = recv(
				termSocket,
				{
					...proto,
					nonce,
					type: "SIG",
					filter: ({ buffer }) => {
						const result = match(null, buffer);
						if (!result) return null;

						if (result.buffer.byteLength !== 1) return null;
						if (new DataView(result.buffer).getUint8(0) !== SIGNAL.TERM)
							return null;
						return result;
					},
				},
				task,
			);

			listen(
				sessionSocket,
				{ ...proto, nonce },
				task,
				sendAtomic.clone(),
				recvTimeoutMs,
				push,
			);

			send(
				sessionSocket,
				{ ...proto, type: "ACK", nonce },
				brand(initStep, new Uint8Array(0).buffer),
			);

			const streamSocket = socket.multiplex();
			const streamHandle = stream(
				streamSocket,
				{ ...proto, nonce },
				task,
				sendAtomic,
				sendTimeoutMs,
				pull,
			);

			streamHandle.then(() => task.cleanup("channel stream finished"));

			term.then(() => {
				streamSocket.drop();
				termSocket.drop();
				sessionSocket.drop();
			});

			return term;
		});

		return sigHandle;
	});

	return task;
}
