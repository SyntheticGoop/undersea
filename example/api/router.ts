import { Router } from "../../framework";

export const router = new Router({
	config: {
		ackDeadline: 1000,
		clientSilentDeadline: Number.POSITIVE_INFINITY,
		serverSilentDeadline: Number.POSITIVE_INFINITY,
	},
});
