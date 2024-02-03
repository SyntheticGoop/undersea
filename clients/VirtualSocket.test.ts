import { describe, expect, it } from "vitest";
import { VirtualSocket } from "./VirtualSocket";

describe(VirtualSocket, async () => {
	it("sends and receives data", async () => {
		const a = new VirtualSocket({ in: 10, out: 10 });
		const b = new VirtualSocket({ in: 10, out: 10 });

		a.outBuffer.connectPush(b.bufferIn.bind(b));
		b.outBuffer.connectPush(a.bufferIn.bind(a));

		a.send(new Uint8Array([0xde, 0xad, 0xbe, 0xef]).buffer);
		expect(
			b.recv(() => true).then((bytes) => [...new Uint8Array(bytes)]),
		).resolves.toEqual([0xde, 0xad, 0xbe, 0xef]);

		b.send(new Uint8Array([0xca, 0xfe, 0xba, 0xbe]).buffer);
		expect(
			a.recv(() => true).then((bytes) => [...new Uint8Array(bytes)]),
		).resolves.toEqual([0xca, 0xfe, 0xba, 0xbe]);
	});

	it("only drops multiplexed sockets and not the main one", () => {
		const socket = new VirtualSocket({ in: 10, out: 10 });

		const multiplexed = socket.multiplex();
		multiplexed.drop();

		expect(
			multiplexed.recv(() => true),
		).rejects.toThrowErrorMatchingInlineSnapshot(
			"[Error: Cannot take after drop]",
		);

		expect(socket.send(new ArrayBuffer(0))).toBeUndefined();
	});

	it("prevents the main socket from being dropped while others are active", () => {
		const socket = new VirtualSocket({ in: 10, out: 10 });

		const multiplexed = socket.multiplex();
		socket.drop();

		expect(socket.recv(() => true)).rejects.toThrowErrorMatchingInlineSnapshot(
			"[Error: Cannot take after drop]",
		);

		expect(multiplexed.send(new ArrayBuffer(0))).toBeUndefined();
	});

	it("drops both the main socket and the multiplexed one", () => {
		const socket = new VirtualSocket({ in: 10, out: 10 });
		const multiplexed = socket.multiplex();

		socket.drop();
		multiplexed.drop();

		expect(socket.recv(() => true)).rejects.toThrowErrorMatchingInlineSnapshot(
			"[Error: Cannot take after drop]",
		);
		expect(
			multiplexed.recv(() => true),
		).rejects.toThrowErrorMatchingInlineSnapshot(
			"[Error: Cannot take after drop]",
		);
	});
});
