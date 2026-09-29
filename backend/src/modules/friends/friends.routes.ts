import { Router } from "express";
import { requireAuth } from "../../middleware/session";
import {
	acceptFriend,
	addFriend,
	compareFriend,
	declineFriend,
	getFriends,
	removeFriendHandler,
} from "./friends.controller";

export const friendsRouter = Router();
friendsRouter.use(requireAuth);

friendsRouter.get("/", getFriends);
friendsRouter.post("/", addFriend);
friendsRouter.post("/:id/accept", acceptFriend);
friendsRouter.post("/:id/decline", declineFriend);
friendsRouter.delete("/:id", removeFriendHandler);
friendsRouter.get("/compare/:friendUserId", compareFriend);
