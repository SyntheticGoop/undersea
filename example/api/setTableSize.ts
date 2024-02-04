import { route0001 } from ".";

export type TableSize = {
	width: number;
	height: number;
};
export const { client, server } = route0001.define<TableSize, null>();
