import type { WebSocket } from "ws";

import { VirtualSocket } from "./VirtualSocket";

/**
 * A `ws` node websocket `Socket` implementation based on {@link VirtualSocket}.
 */
export class NodeWsWebsocketSocket extends VirtualSocket {
	constructor(
		private readonly socket: WebSocket,
		bufferSize: { in: number; out: number },
	) {
		super(bufferSize);

		socket.on("message", (data, isBinary) => {
			if (!isBinary) return;
			if (data instanceof ArrayBuffer) {
				this.bufferIn(data);
			} else if (data instanceof Buffer) {
				this.bufferIn(
					data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
				);
			} else if (Array.isArray(data)) {
				for (const entry of data) {
					this.bufferIn(
						entry.buffer.slice(
							entry.byteOffset,
							entry.byteOffset + entry.byteLength,
						),
					);
				}
			}
		});

		if (this.socket.readyState === this.socket.OPEN) {
			this.bindSend();
		}

		socket.on("open", () => this.bindSend());

		socket.on("close", () => this.drop());
	}

	private sendBound = false;
	private bindSend() {
		if (this.sendBound) return;
		this.sendBound = true;

		this.outBuffer.connectPush((bytes) => {
			switch (this.socket.readyState) {
				case this.socket.OPEN:
					this.socket.send(bytes);
					break;

				case this.socket.CONNECTING:
					console.warn(
						"Websocket cannot be connecting if callback is bound on open",
					);
					break;
				case this.socket.CLOSING:
					console.warn("Cannot send data while closing");
					break;

				case this.socket.CLOSED:
					console.warn("Cannot send data while closed");
					break;
			}
		});
	}

	public drop() {
		super.dropAll();
		this.socket.close();
	}
}
