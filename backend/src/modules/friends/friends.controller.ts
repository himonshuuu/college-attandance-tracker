import type { Request, Response } from "express";
import {
	acceptRequest,
	compareWithFriend,
	declineRequest,
	FriendsError,
	listFriends,
	removeFriend,
	sendFriendRequest,
} from "./friends.service";
import { parseAddFriendQuery } from "./friends.validators";

function handleError(response: Response, error: unknown) {
	if (error instanceof FriendsError)
		return response
			.status(error.status)
			.json({ success: false, error: error.message });
	throw error;
}

export async function getFriends(request: Request, response: Response) {
	return response.json(await listFriends(request.session!.userId));
}

export async function addFriend(request: Request, response: Response) {
	try {
		const query = parseAddFriendQuery(request.body as Record<string, unknown>);
		const result = await sendFriendRequest(request.session!.userId, query);
		return response.json({ success: true, ...result });
	} catch (error) {
		return handleError(response, error);
	}
}

export async function acceptFriend(request: Request, response: Response) {
	try {
		await acceptRequest(String(request.params.id), request.session!.userId);
		return response.json({ success: true });
	} catch (error) {
		return handleError(response, error);
	}
}

export async function declineFriend(request: Request, response: Response) {
	try {
		await declineRequest(String(request.params.id), request.session!.userId);
		return response.json({ success: true });
	} catch (error) {
		return handleError(response, error);
	}
}

export async function removeFriendHandler(
	request: Request,
	response: Response,
) {
	await removeFriend(String(request.params.id), request.session!.userId);
	return response.json({ success: true });
}

export async function compareFriend(request: Request, response: Response) {
	try {
		const result = await compareWithFriend(
			request.session!.userId,
			request.session!.enrollmentId,
			Number(request.params.friendUserId),
		);
		return response.json(result);
	} catch (error) {
		if (error instanceof FriendsError)
			return response.status(error.status).json({ error: error.message });
		throw error;
	}
}
