import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
	plugins: [solid()],
	server: {
		proxy: {
			"/ws": {
				target: "http://localhost:5714",
				changeOrigin: true,
				ws: true,
			},
		},
	},
});
