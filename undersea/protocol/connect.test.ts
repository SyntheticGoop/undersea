import { describe, expect, it } from "vitest";
import { connect } from "./connect";
import { Socket } from "../lib/Socket";
import { CancellableResult, Task } from "../lib/Task";

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

describe(connect, () => {
	it("won't connect if sig is not acked", async () => {
		const socket = new MockSocket([]);
		const task = new Task();

		const sent: number[][] = [];
		socket.recv((data) => {
			sent.push([...new Uint8Array(data)]);

			return false;
		});
		const connection = connect(
			socket.multiplex(),
			{ key: 1, nonce: 4 },
			task,
			100,
			0,
			() => null,
			() => {},
		);

		expect(await connection.isCancelled).toMatchObject({
			reason: "timeout: sig init",
		});
		expect(sent).toMatchInlineSnapshot([[1, 0, 1, 0, 4, 0, 0, 0, 0, 0]]);
	});

	it("remains open until close if sig is acked", async () => {
		const socket = new MockSocket([]);
		const task = new Task();

		socket.recv((data) => {
			const view = new DataView(data);
			if (view.getUint8(0) === 0b01) {
				socket.send(
					new Uint8Array([0b11, ...new Uint8Array(data.slice(1, 9))]).buffer,
				);
			}
			return false;
		});

		const connection = connect(
			socket.multiplex(),
			{ key: 1, nonce: 4 },
			task,
			5,
			1000,
			() => wait(10000).then(() => new Uint8Array().buffer),
			() => {},
		);

		await wait(5);

		expect(
			await Promise.race([connection.isCancelled, wait(30).then(() => null)]),
		).toBeNull();

		task.cleanup("test");
	});

	it("sends term signal after stream is done", async () => {
		const socket = new MockSocket([]);
		const task = new Task();

		const sent: number[][] = [];
		socket.recv((data) => {
			const view = new DataView(data);
			sent.push([...new Uint8Array(data)]);
			if (view.getUint8(0) !== 0b11) {
				socket.send(
					new Uint8Array([0b11, ...new Uint8Array(data.slice(1, 9))]).buffer,
				);
			}
			return false;
		});

		const connection = connect(
			socket.multiplex(),
			{ key: 1, nonce: 4 },
			task,
			10,
			50,
			(() => {
				let done = 1;

				return async () => {
					if (done === 0) return null;
					done--;
					return new Uint8Array([0xde, 0xad]).buffer;
				};
			})(),
			() => {},
		);

		await wait(10);

		expect(await connection.isCancelled).toMatchInlineSnapshot(`
			{
			  "reason": "cleanup: connect stream finished",
			}
		`);

		await wait(15);

		expect(sent).toMatchInlineSnapshot([
			[0b01, 0, 1, 0, 4, 0, 0, 0, 0, 0], // sig init
			[0b11, 0, 1, 0, 4, 0, 0, 0, 0], // init ack
			[0b10, 0, 1, 0, 4, 1, 0, 0, 0, 0xde, 0xad], // msg
			[0b11, 0, 1, 0, 4, 1, 0, 0, 0], // msg ack
			[0b11, 0, 1, 0, 4, 1, 0, 0, 0], // msg ack
			[0b01, 0, 1, 0, 4, 2, 0, 0, 0, 1], // sig term
			[0b11, 0, 1, 0, 4, 2, 0, 0, 0], // term ack
		]);

		task.cleanup("test");
	});

	it("receives data", async () => {
		const socket = new MockSocket([]);
		const task = new Task();

		const recv: CancellableResult<ArrayBuffer>[] = [];
		socket.recv((data) => {
			const view = new DataView(data);
			if (view.getUint8(0) === 0b01) {
				socket.send(
					new Uint8Array([0b11, ...new Uint8Array(data.slice(1, 9))]).buffer,
				);
			}
			return false;
		});

		const connection = connect(
			socket.multiplex(),
			{ key: 1, nonce: 4 },
			task,
			10,
			1000,
			() => wait(50).then(() => null),
			(data) => recv.push(data),
		);

		await wait(5);

		wait(10).then(() =>
			socket.send(
				new Uint8Array([0b10, 0x00, 0x01, 0x00, 0x04, 1, 0, 0, 0, 1]).buffer,
			),
		);

		wait(30).then(() =>
			socket.send(
				new Uint8Array([0b10, 0x00, 0x01, 0x00, 0x04, 2, 0, 0, 0, 2]).buffer,
			),
		);

		wait(20).then(() => task.cleanup("test"));

		expect(await connection.isCancelled).toMatchInlineSnapshot(`
			{
			  "reason": "cleanup: test",
			}
		`);

		await wait(10);

		expect(recv.map(serializeResult)).toMatchInlineSnapshot([
			{
				value: [1],
			},
			{
				reason: "parent cancelled: finished",
			},
		]);

		task.cleanup("test");
	});
});
