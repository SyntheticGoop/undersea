import { Router } from "../../framework";

const router = new Router({
	config: {
		ackDeadline: 1000,
		clientSilentDeadline: Number.POSITIVE_INFINITY,
		serverSilentDeadline: Number.POSITIVE_INFINITY,
	},
});

export const route0000 = router.routeClientSendStream();
export const route0001 = router.routeClientSendStreamOnly();

export const { clientRouter, serverRouter } = router;
