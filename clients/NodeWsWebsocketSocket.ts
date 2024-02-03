import { WebSocket } from "ws";

import { VirtualSocket } from "./VirtualSocket";

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

		if (this.socket.readyState === WebSocket.OPEN) {
			this.bindSend();
		}

		socket.on("open", async () => {
			this.bindSend();
		});
	}

	private sendBound = false;
	private bindSend() {
		if (this.sendBound) return;
		this.sendBound = true;

		this.outBuffer.connectPush((bytes) => {
			switch (this.socket.readyState) {
				case WebSocket.OPEN:
					this.socket.send(bytes);
					break;

				case WebSocket.CONNECTING:
					console.warn(
						"Websocket cannot be connecting if callback is bound on open",
					);
					break;
				case WebSocket.CLOSING:
					console.warn("Cannot send data while closing");
					break;

				case WebSocket.CLOSED:
					console.warn("Cannot send data while closed");
					break;
			}
		});
	}

	public drop() {
		this.socket.on("close", () => super.drop());
		this.socket.close();
	}
}
