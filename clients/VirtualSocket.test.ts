import { describe, expect, it } from "vitest";
import { VirtualSocket } from "./VirtualSocket";
import { Task } from "../lib/Task";

describe(VirtualSocket, async () => {
	it("sends and receives data", async () => {
		const task = new Task();
		const a = new VirtualSocket({ in: 10, out: 10 });
		const b = new VirtualSocket({ in: 10, out: 10 });

		a.outBuffer.connectPush(b.bufferIn.bind(b));
		b.outBuffer.connectPush(a.bufferIn.bind(a));

		a.send(new Uint8Array([0xde, 0xad, 0xbe, 0xef]).buffer);
		expect(
			b.recv(() => true, task).then((bytes) => [...new Uint8Array(bytes)]),
		).resolves.toEqual([0xde, 0xad, 0xbe, 0xef]);

		b.send(new Uint8Array([0xca, 0xfe, 0xba, 0xbe]).buffer);
		expect(
			a.recv(() => true, task).then((bytes) => [...new Uint8Array(bytes)]),
		).resolves.toEqual([0xca, 0xfe, 0xba, 0xbe]);
	});

	it("only drops multiplexed sockets and not the main one", () => {
		const task = new Task();
		const socket = new VirtualSocket({ in: 10, out: 10 });

		const multiplexed = socket.multiplex();
		multiplexed.drop();

		expect(
			multiplexed.recv(() => true, task),
		).rejects.toThrowErrorMatchingInlineSnapshot(
			"[Error: Cannot take after drop]",
		);

		expect(socket.send(new ArrayBuffer(0))).toBeUndefined();
	});

	it("prevents the main socket from being dropped while others are active", () => {
		const task = new Task();
		const socket = new VirtualSocket({ in: 10, out: 10 });

		const multiplexed = socket.multiplex();
		socket.drop();

		expect(
			socket.recv(() => true, task),
		).rejects.toThrowErrorMatchingInlineSnapshot(
			"[Error: Cannot take after drop]",
		);

		expect(multiplexed.send(new ArrayBuffer(0))).toBeUndefined();
	});

	it("drops both the main socket and the multiplexed one", () => {
		const task = new Task();
		const socket = new VirtualSocket({ in: 10, out: 10 });
		const multiplexed = socket.multiplex();

		socket.drop();
		multiplexed.drop();

		expect(
			socket.recv(() => true, task),
		).rejects.toThrowErrorMatchingInlineSnapshot(
			"[Error: Cannot take after drop]",
		);
		expect(
			multiplexed.recv(() => true, task),
		).rejects.toThrowErrorMatchingInlineSnapshot(
			"[Error: Cannot take after drop]",
		);
	});

	it("Cancels recv on task end before start", async () => {
		const task = new Task();
		const socket = new VirtualSocket({ in: 10, out: 10 });
		task.cancel("test");
		const recv = socket.recv(() => true, task);

		expect(recv).rejects.toThrowErrorMatchingInlineSnapshot(
			"[Error: Task cancelled]",
		);
	});

	it("Cancels recv on task end after start", async () => {
		const task = new Task();
		const socket = new VirtualSocket({ in: 10, out: 10 });
		const recv = socket.recv(() => true, task);
		task.cancel("test");

		expect(recv).rejects.toThrowErrorMatchingInlineSnapshot(
			"[Error: Task cancelled]",
		);
	});

	it("drops all shared sockets", async () => {
		const task = new Task();
		const socket = new VirtualSocket({ in: 10, out: 10 });
		const multiplexed = socket.multiplex();

		socket.dropAll();
		await socket.closed;
		await multiplexed.closed;
	});
});
