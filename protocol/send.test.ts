import { describe, expect, it } from "vitest";
import { send } from "./send";
import { Socket } from "../lib/Socket";

function wait(ms: number) {
	if (ms === 0) return Promise.resolve();
	return new Promise((res) => setTimeout(res, ms));
}

class MockSocket implements Socket {
	constructor(public delays: number[]) {
		this.broadcast.add(this);
	}

	private readonly buffer: ArrayBuffer[] = [];

	public async recv(filter: (data: ArrayBuffer) => boolean) {
		while (true) {
			const buffer = this.buffer.shift();
			if (buffer && filter(buffer)) {
				return Promise.resolve(buffer);
			}

			await wait(1);
		}
	}

	private broadcast = new Set<MockSocket>();

	public async send(data: ArrayBuffer) {
		await wait(this.delays.shift() ?? 0);

		for (const channel of this.broadcast) {
			channel.buffer.push(data);
		}
	}

	public multiplex(): MockSocket {
		const socket = new MockSocket([]);

		this.broadcast.add(socket);
		socket.broadcast = this.broadcast;

		return socket;
	}
	public drop() {}

	public closed: Promise<void> = Promise.resolve();
}

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
function serializeResult(state: any) {
	if (
		typeof state.reason !== "undefined" ||
		!(state.value instanceof ArrayBuffer)
	)
		return state;

	return {
		value: [...new Uint8Array(state.value)],
	};
}

describe(send, () => {
	it("sends data on the socket", async () => {
		const socket = new MockSocket([]);

		socket.recv((data) => {
			expect([...new Uint8Array(data)]).toMatchObject([
				0b10, 0x00, 0x01, 0x00, 0x04, 1, 0, 1,
			]);
			return false;
		});

		send(
			socket,
			{ key: 1, nonce: 4, type: "MSG" },
			new Uint8Array([1, 0, 1]).buffer,
		);
	});
});
