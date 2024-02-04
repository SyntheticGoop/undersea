import { WebSocketServer } from "ws";
import { PongGameEngine } from "./src/Pong/PongGameEngine";
import { setTableSize, getGameState, serverRouter } from "./api";
import { NodeWsWebsocketSocket } from "../clients/NodeWsWebsocketSocket";

type Connection = {
	engine: PongGameEngine;
};

const getGameStateHandle = getGameState.server
	.withConnection<Connection>()
	.asRecvStream(
		() =>
			async (data, { connection: { engine } }) => {
				engine.advanceGame(data.time);

				return engine.data;
			},
		10,
		(data): data is getGameState.GameTick => true,
	);

const setTableSizeHandle = setTableSize.server
	.withConnection<Connection>()
	.asRecvStreamOnly(
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

			const server = serverRouter()
				.withConnection(async () => ({
					connection: { engine },
					socket,
				}))
				.withRoutes(getGameStateHandle, setTableSizeHandle)
				.start();
		});

		await new Promise((ok) => {
			server.on("close", ok);
		});
	}
}

createServerWebsocketConnection();
