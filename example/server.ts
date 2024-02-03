import { WebSocketServer } from "ws";
import { NodeWsWebsocketSocket } from "../undersea/clients/NodeWsWebsocketSocket";
import { PongGameEngine } from "./src/Pong/PongGameEngine";
import { setTableSize, getGameState, bindServer } from "./api";

const getGameStateHandle = getGameState.server.asRecvStream(
	() =>
		async (data, { connection: { engine } }) => {
			engine.advanceGame(data.time);

			return engine.data;
		},
	10,
	(data): data is getGameState.GameTick => true,
);

const setTableSizeHandle = setTableSize.server.asRecvStreamOnly(
	() => {
		return async (data, { connection: { engine } }) => {
			engine.setTableSize(data.width, data.height);
		};
	},
	50,
	(data): data is setTableSize.TableSize => true,
);

async function createServerWebsocketConnection() {
	while (true) {
		const server = new WebSocketServer({ port: 5714 });

		await new Promise((ok) => {
			server.on("listening", ok);
		});

		server.on("connection", async (ws) => {
			const socket = new NodeWsWebsocketSocket(ws, {
				in: 100,
				out: 100,
			});

			const engine = new PongGameEngine();

			const server = bindServer(null, async () => ({
				connection: { engine },
				socket,
			}));

			getGameStateHandle(server);
			setTableSizeHandle(server);
		});

		await new Promise((ok) => {
			server.on("close", ok);
		});
	}
}

createServerWebsocketConnection();
