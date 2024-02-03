import { VirtualSocket } from "./VirtualSocket";

export class BrowserWsWebsocketSocket extends VirtualSocket {
	constructor(
		private readonly socket: WebSocket,
		bufferSize: {
			in: number;
			out: number;
		},
	) {
		super(bufferSize);

		socket.addEventListener("message", (event) => {
			if (typeof event.data === "string") return;
			if (event.data instanceof ArrayBuffer) {
				this.bufferIn(event.data);
			} else if (event.data instanceof Blob) {
				event.data.arrayBuffer().then((buffer) => this.bufferIn(buffer));
			}
		});

		if (this.socket.readyState === WebSocket.OPEN) {
			this.bindSend();
		}
		socket.addEventListener("open", async () => {
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
		this.socket.addEventListener("close", () => super.drop());
		this.socket.close();
	}
}
