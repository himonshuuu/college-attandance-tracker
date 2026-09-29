import {
	currentPeriod,
	getCachedAttendance,
	summarize,
} from "../attendance/attendance.service";
import {
	MAX_FRIENDS,
	acceptFriendshipById,
	countAcceptedFriends,
	createFriendRequest,
	declineFriendshipById,
	findFriendship,
	findUserByIdForCompare,
	findUserForFriendQuery,
	isAcceptedFriend,
	listFriendshipRows,
	markFriendshipAccepted,
	removeFriendshipById,
} from "./friends.repository";

export class FriendsError extends Error {
	constructor(
		message: string,
		public readonly status: number,
	) {
		super(message);
		this.name = "FriendsError";
	}
}

export async function listFriends(userId: number) {
	const rows = await listFriendshipRows(userId);
	const accepted = rows.filter((row) => row.status === "accepted");
	const friends = await Promise.all(
		accepted.map(async (row) => {
			const otherId = row.user_id === userId ? row.friend_user_id : row.user_id;
			const enrollmentId = row.user_id === userId ? row.to_eid : row.from_eid;
			const period = currentPeriod();
			const records = await getCachedAttendance(
				enrollmentId,
				period.year,
				period.month,
			).catch(() => []);
			const summary = summarize(records);
			return {
				id: row.id,
				userId: otherId,
				name: row.user_id === userId ? row.to_name : row.from_name,
				enrollmentId,
				pct: summary.pct,
				total: summary.total,
			};
		}),
	);
	const incoming = rows
		.filter((row) => row.status === "pending" && row.friend_user_id === userId)
		.map((row) => ({
			id: row.id,
			userId: row.user_id,
			name: row.from_name,
			enrollmentId: row.from_eid,
		}));
	const outgoing = rows
		.filter((row) => row.status === "pending" && row.user_id === userId)
		.map((row) => ({
			id: row.id,
			userId: row.friend_user_id,
			name: row.to_name,
			enrollmentId: row.to_eid,
		}));
	return { friends, incoming, outgoing, maxFriends: MAX_FRIENDS };
}

export async function sendFriendRequest(userId: number, query: string) {
	const target = await findUserForFriendQuery(query);
	if (!target)
		throw new FriendsError(
			"No student found with that email or enrollment ID.",
			404,
		);
	if (target.id === userId)
		throw new FriendsError("You can't add yourself.", 400);
	const existing = await findFriendship(userId, target.id);
	if (existing) {
		if (existing.status === "accepted")
			throw new FriendsError("You're already friends.", 409);
		if (existing.friend_user_id === userId) {
			await markFriendshipAccepted(existing.id);
			return { message: `You're now friends with ${target.name}!` };
		}
		throw new FriendsError("Request already sent.", 409);
	}
	if ((await countAcceptedFriends(userId)) >= MAX_FRIENDS)
		throw new FriendsError(`You can have up to ${MAX_FRIENDS} friends.`, 400);
	await createFriendRequest(userId, target.id);
	return { message: `Friend request sent to ${target.name}!` };
}

export async function acceptRequest(id: string, userId: number) {
	if (!(await acceptFriendshipById(id, userId)))
		throw new FriendsError("Request not found.", 404);
}

export async function declineRequest(id: string, userId: number) {
	if (!(await declineFriendshipById(id, userId)))
		throw new FriendsError("Request not found.", 404);
}

export async function removeFriend(id: string, userId: number) {
	await removeFriendshipById(id, userId);
}

export async function compareWithFriend(
	userId: number,
	enrollmentId: string,
	friendUserId: number,
) {
	if (!(await isAcceptedFriend(userId, friendUserId)))
		throw new FriendsError("You're not friends with this student.", 403);
	const friend = await findUserByIdForCompare(friendUserId);
	if (!friend) throw new FriendsError("Student not found.", 404);
	const period = currentPeriod();
	const [mine, theirs] = await Promise.all([
		getCachedAttendance(enrollmentId, period.year, period.month),
		getCachedAttendance(friend.enrollment_id, period.year, period.month),
	]);
	const me = summarize(mine);
	const other = summarize(theirs);
	const friendSubjects = new Map(
		other.subjects.map((subject) => [subject.name, subject.pct]),
	);
	const subjects = [
		...new Set([
			...me.subjects.map((s) => s.name),
			...other.subjects.map((s) => s.name),
		]),
	]
		.sort()
		.map((name) => {
			const mePct =
				me.subjects.find((subject) => subject.name === name)?.pct ?? null;
			const friendPct = friendSubjects.get(name) ?? null;
			return {
				name,
				mePct,
				friendPct,
				delta: mePct != null && friendPct != null ? mePct - friendPct : null,
			};
		});
	return {
		month: period.month,
		year: period.year,
		me: {
			name: "You",
			total: me.total,
			present: me.present,
			pct: me.pct,
			subjects: me.subjects,
		},
		friend: {
			name: friend.name,
			total: other.total,
			present: other.present,
			pct: other.pct,
			subjects: other.subjects,
		},
		subjects,
	};
}
