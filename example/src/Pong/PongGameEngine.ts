import { PositionControl } from "./PositionControl";

export class PongGameEngine {
	data = {
		score: {
			player1: 0,
			player2: 0,
		},
		ball: {
			x: 0,
			y: 0,
			angle: 0,
			speed: 1,
		},
		player1: {
			y: 0,
			x: 0,
			height: 100,
			width: 6,
		},
		player2: {
			y: 0,
			x: 0,
			height: 100,
			width: 6,
		},
		table: {
			width: 0,
			height: 0,
		},
		lastTick: -1,
	};

	setTableSize(width: number, height: number) {
		if (this.data.table.width === width && this.data.table.height === height)
			return;
		this.data.table.width = width;
		this.data.table.height = height;

		this.data.player1.x = 5;
		this.data.player1.y = height / 2 - this.data.player1.height / 2;

		this.data.player2.x = width - 5 - this.data.player2.width;
		this.data.player2.y = height / 2 - this.data.player2.height / 2;

		this.resetBall();
	}

	resetBall() {
		this.data.ball.x = this.data.table.width / 2;
		this.data.ball.y = this.data.table.height / 2;
		this.data.ball.angle = 0.5;
	}

	resetGame() {
		this.data.score.player1 = 0;
		this.data.score.player2 = 0;
		this.resetBall();
	}

	/**
	 * Returns the current tick of the game.
	 */
	updateTick(now: number): number {
		if (this.data.lastTick === -1) {
			this.data.lastTick = now;
			return 0;
		}
		const dt = now - this.data.lastTick;
		this.data.lastTick = now;
		return dt / 2;
	}

	moveBall(dt: number) {
		const ball = this.data.ball;
		ball.x += Math.cos(ball.angle) * ball.speed * dt;
		ball.y += Math.sin(ball.angle) * ball.speed * dt;

		// The ball hit the player1 paddle.
		if (
			ball.x < this.data.player1.width &&
			ball.y > this.data.player1.y &&
			ball.y < this.data.player1.y + this.data.player1.height
		) {
			ball.angle = Math.PI - ball.angle;
		}

		// The ball hit the player2 paddle.
		if (
			ball.x > this.data.table.width - this.data.player2.width &&
			ball.y > this.data.player2.y &&
			ball.y < this.data.player2.y + this.data.player2.height
		) {
			ball.angle = Math.PI - ball.angle;
		}

		// The ball hit a wall. Reflect the angle.
		if (ball.y < 0 || ball.y > this.data.table.height) {
			ball.angle = -ball.angle;
		}

		// The ball has hit the left or right wall. Calculate the score and reset the ball.
		if (ball.x < 0) {
			this.data.score.player2 += 1;
			this.resetBall();
		}
		if (ball.x > this.data.table.width) {
			this.data.score.player1 += 1;
			this.resetBall();
		}
	}

	moveAiPaddle(dt: number, paddle: this["data"]["player1"]) {
		const ball = this.data.ball;
		const targetY = ball.y - paddle.height / 2;
		const dy = targetY - paddle.y;
		const speed = 0.7;
		const maxDy = speed * dt;
		if (dy > maxDy) {
			paddle.y += maxDy;
		} else if (dy < -maxDy) {
			paddle.y -= maxDy;
		} else {
			paddle.y = targetY;
		}
	}

	advanceGame(time: number) {
		const dt = this.updateTick(time);
		this.moveBall(dt);
		this.moveAiPaddle(dt, this.data.player1);
		this.moveAiPaddle(dt, this.data.player2);
	}

	setPlayer1Paddle(position: PositionControl) {
		position.y = this.data.player1.y;
		position.x = this.data.player1.x;
	}

	setPlayer2Paddle(position: PositionControl) {
		position.y = this.data.player2.y;
		position.x = this.data.player2.x;
	}

	setBall(position: PositionControl) {
		position.y = this.data.ball.y;
		position.x = this.data.ball.x;
	}
}
