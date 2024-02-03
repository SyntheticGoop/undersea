import { Router } from "../../undersea/framework";
import { PongGameEngine } from "../src/Pong/PongGameEngine";

export const router = new Router<null, null, { engine: PongGameEngine }>({
	config: {
		ackDeadline: 1000,
		channelSilentDeadline: Number.POSITIVE_INFINITY,
		connectSilentDeadline: Number.POSITIVE_INFINITY,
	},
});
