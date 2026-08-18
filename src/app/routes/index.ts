import { Router } from "express";

const router = Router();

router.get("/", (_req, res) => {
	res.status(200).json({
		message: "API is ready",
		endpoints: {
			health: "/health"
		}
	});
});

export const indexRoute = router;