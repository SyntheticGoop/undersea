import { Ball } from "./Ball";
import { Paddle } from "./Paddle";
import { createSignal, onMount } from "solid-js";
import { PositionControl } from "./PositionControl";
import { BrowserWsWebsocketSocket } from "../../../undersea/clients/BrowserWesocketSocket";
import { bindClient } from "../../api";
import { setTableSize, getGameState } from "../../api";

const getGameStateHandler = getGameState.client.asSendStream(10);
const setTableSizeHandler = setTableSize.client.asSendStreamOnly(50);

export function Pong() {
	const [p1Ref, setP1Ref] = createSignal<PositionControl>();
	const [p2Ref, setP2Ref] = createSignal<PositionControl>();
	const [ballRef, setBallRef] = createSignal<PositionControl>();
	const [boardRef, setBoardRef] = createSignal<HTMLElement>();

	const websocket = new WebSocket(`ws://${location.host}/ws`);

	const socket = new BrowserWsWebsocketSocket(websocket, { in: 100, out: 100 });

	const client = bindClient(null, async () => {
		new Promise<void>((ok) => {
			if (websocket.readyState === websocket.CLOSED) return ok();
			websocket.addEventListener("close", ok);
		});
		return {
			connection: null,
			socket: socket.multiplex(),
		};
	});

	onMount(() => {
		// const engine = new PongGameEngine();

		const rect = boardRef()!.getBoundingClientRect();
		const p1 = p1Ref()!;
		const p2 = p2Ref()!;
		const ball = ballRef()!;

		p1.setDelta(rect.x, rect.y);
		p2.setDelta(rect.x, rect.y);
		ball.setDelta(rect.x, rect.y);

		const engine = getGameStateHandler.start(client);
		const updateSize = setTableSizeHandler.start(client);

		async function advance() {
			const rect = boardRef()!.getBoundingClientRect();

			while (true) {
				if (await updateSize({ width: rect.width, height: rect.height })) break;
				await new Promise((ok) => setTimeout(ok, 1));
			}

			while (true) {
				const data = await engine({ time: Date.now() });
				if (data === false) {
					await new Promise((ok) => setTimeout(ok, 1));
					continue;
				}

				console.log("update", data);
				// engine.advanceGame();

				// engine.setTableSize(rect.width, rect.height);

				p1.y = data.player1.y;
				p1.x = data.player1.x;

				p2.y = data.player2.y;
				p2.x = data.player2.x;

				ball.y = data.ball.y;
				ball.x = data.ball.x;
				// await new Promise((ok) => setTimeout(ok, 1000));
				break;
			}
			requestAnimationFrame(advance);
		}
		advance();
	});

	return (
		<div
			class="h-[500px] w-[500px] bg-gray-200 rounded-sm shadow-lg relative isolate"
			ref={setBoardRef}
		>
			<Paddle onControl={setP1Ref} />
			<Ball onControl={setBallRef} />
			<Paddle onControl={setP2Ref} />
		</div>
	);
}