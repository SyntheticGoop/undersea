import { WebSocketServer } from "ws";
import { PongGameEngine } from "./src/Pong/PongGameEngine";
import * as getGameState from "./api/getGameState";
import * as setTableSize from "./api/setTableSize";
import * as frameCounter from "./api/frameCounter";
import { serverRouter } from "./api";
import { NodeWsWebsocketSocket } from "../clients/NodeWsWebsocketSocket";

type Connection = {
	engine: PongGameEngine;
	tick: number;
};

const getGameStateHandle = getGameState.server
	.withConnection<Connection>()
	.asRecvChannel(
		() =>
			async (data, { connection }) => {
				connection.engine.advanceGame(data.time);
				connection.tick++;

				return connection.engine.data;
			},
		10,
		(data): data is getGameState.GameTick => true,
	);

const setTableSizeHandle = setTableSize.server
	.withConnection<Connection>()
	.asRecvStream(
		() => {
			return async (data, { connection: { engine } }) => {
				engine.setTableSize(data.width, data.height);
			};
		},
		50,
		(data): data is setTableSize.TableSize => true,
	);

const frameCounterHandle = frameCounter.server
	.withConnection<Connection>()
	.asRecvListen(
		() => ({
			recv(init, send, context) {
				context.task.poll(async () => {
					send({ frame: `${init.name}: ${context.connection.tick}` });
					await new Promise((ok) => setTimeout(ok, 10));
					return { value: null };
				});
			},
		}),
		100,
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

			const connection = { engine, tick: 0 };
			const server = serverRouter()
				.withConnection(async () => ({
					connection,
					socket,
				}))
				.withRoutes(getGameStateHandle, setTableSizeHandle, frameCounterHandle)
				.start();
		});

		await new Promise((ok) => {
			server.on("close", ok);
		});
	}
}

createServerWebsocketConnection();
