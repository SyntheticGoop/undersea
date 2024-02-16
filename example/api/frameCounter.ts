import { route0002 } from "./index";

type ServerRecv = {
	name: string;
};

type ClientRecv = {
	frame: string;
};

export const { client, server } = route0002.define<ServerRecv, ClientRecv>();
