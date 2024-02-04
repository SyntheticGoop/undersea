import { route0000 } from ".";

export type GameTick = {
	time: number;
};
export type GameState = {
	ball: {
		x: number;
		y: number;
	};
	player1: {
		x: number;
		y: number;
	};
	player2: {
		x: number;
		y: number;
	};
};
export const { client, server } = route0000.define<GameTick, GameState>();
