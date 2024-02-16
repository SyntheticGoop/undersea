import { Ball } from "./Ball";
import { Paddle } from "./Paddle";
import { createSignal, onMount } from "solid-js";
import { PositionControl } from "./PositionControl";
import { BrowserWebsocketSocket } from "../../../clients/BrowserWebsocketSocket";
import { clientRouter } from "../../api";
import * as getGameState from "../../api/getGameState";
import * as setTableSize from "../../api/setTableSize";
import * as frameCounter from "../../api/frameCounter";

const getGameStateHandler = getGameState.client.asSendChannel(10);
const setTableSizeHandler = setTableSize.client.asSendStream(50);
const frameCounterHandler = frameCounter.client.asSendListen(100);

export function Pong() {
	const [p1Ref, setP1Ref] = createSignal<PositionControl>();
	const [p2Ref, setP2Ref] = createSignal<PositionControl>();
	const [ballRef, setBallRef] = createSignal<PositionControl>();
	const [boardRef, setBoardRef] = createSignal<HTMLElement>();
	const [frame, setFrame] = createSignal("");

	const websocket = new WebSocket(`ws://${location.host}/ws`);

	const socket = new BrowserWebsocketSocket(websocket, { in: 100, out: 100 });

	const client = clientRouter()
		.withConnection(async () => {
			new Promise<void>((ok) => {
				if (websocket.readyState === websocket.CLOSED) return ok();
				websocket.addEventListener("close", ok);
			});
			return {
				connection: null,
				socket: socket.multiplex(),
			};
		})
		.start();

	onMount(() => {
		const rect = boardRef()!.getBoundingClientRect();
		const p1 = p1Ref()!;
		const p2 = p2Ref()!;
		const ball = ballRef()!;

		p1.setDelta(rect.x, rect.y);
		p2.setDelta(rect.x, rect.y);
		ball.setDelta(rect.x, rect.y);

		const engine = getGameStateHandler.connect(client);
		const updateSize = setTableSizeHandler.connect(client);

		frameCounterHandler
			.connect(client)
			.recv({ name: "tick" }, (update) => setFrame(update.frame));

		async function advance() {
			const rect = boardRef()!.getBoundingClientRect();

			while (true) {
				try {
					if (await updateSize.send({ width: rect.width, height: rect.height }))
						break;
				} catch {
					await new Promise((ok) => setTimeout(ok, 1));
				}
			}

			while (true) {
				try {
					const data = await engine.send({ time: Date.now() });

					p1.y = data.player1.y;
					p1.x = data.player1.x;

					p2.y = data.player2.y;
					p2.x = data.player2.x;

					ball.y = data.ball.y;
					ball.x = data.ball.x;
				} catch {
					await new Promise((ok) => setTimeout(ok, 1));
					continue;
				}
				// await new Promise((ok) => setTimeout(ok, 1000));
				break;
			}
			requestAnimationFrame(advance);
		}
		advance();
	});

	return (
		<>
			<p class="text-white">{frame()}</p>
			<div
				class="h-[500px] w-[500px] bg-gray-200 rounded-sm shadow-lg relative isolate"
				ref={setBoardRef}
			>
				<Paddle onControl={setP1Ref} />
				<Ball onControl={setBallRef} />
				<Paddle onControl={setP2Ref} />
			</div>
		</>
	);
}
