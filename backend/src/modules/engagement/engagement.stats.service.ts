import {
	currentPeriod,
	getCachedAttendance,
	summarize,
} from "../attendance/attendance.service";
import {
	countAcceptedFriends,
	countActiveUsers,
	getUserMeta,
	getUserRank,
} from "./engagement.repository";
import {
	awardBadges,
	BADGES,
	computeStreaks,
	headlineFor,
	listBadges,
	perfectWeeks,
} from "./engagement.service";

export async function getOverview(userId: number, enrollmentId: string) {
	const period = currentPeriod();
	const records = await getCachedAttendance(
		enrollmentId,
		period.year,
		period.month,
		15,
	);
	const summary = summarize(records);
	const rank = await getUserRank(
		enrollmentId,
		`${period.year}-${period.month}`,
	);
	const user = await getUserMeta(userId);
	const streak = computeStreaks(records);
	const weeks = perfectWeeks(records);
	const totalStudents = await countActiveUsers();
	const freshBadges = user
		? await awardBadges(userId, {
				bestStreak: streak.best,
				currentStreak: streak.current,
				perfectWeeks: weeks,
				totalPresents: summary.present,
				totalAbsents: summary.absent,
				rank,
			})
		: [];
	const ownedBadges = await listBadges(userId);
	const joinedAt = user?.created_at ? new Date(user.created_at).getTime() : 0;
	const friendsCount = await countAcceptedFriends(userId);
	return {
		month: period.month,
		year: period.year,
		...summary,
		streak,
		perfectWeeks: weeks,
		rank,
		totalStudents,
		badges: BADGES.map((badge) => ({
			...badge,
			owned: ownedBadges.includes(badge.id),
			isNew: freshBadges.includes(badge.id),
		})),
		headline: headlineFor(summary.pct, summary.total),
		joinedRecently: Date.now() - joinedAt < 7 * 24 * 60 * 60 * 1000,
		friendsCount,
		checksText: "Mon–Sat, 9:15 AM – 4:45 PM IST (checked after every class)",
	};
}

export async function getYearly(enrollmentId: string, yearParam?: string) {
	const now = new Date();
	const year = Number(yearParam ?? now.getFullYear());
	const months = [
		"January",
		"February",
		"March",
		"April",
		"May",
		"June",
		"July",
		"August",
		"September",
		"October",
		"November",
		"December",
	];
	const max = year === now.getFullYear() ? now.getMonth() + 1 : 12;
	const monthRows = [];
	for (const month of months.slice(0, max)) {
		const summary = summarize(
			await getCachedAttendance(enrollmentId, year, month),
		);
		monthRows.push({ month, ...summary, hasData: summary.total > 0 });
	}
	const total = monthRows.reduce((sum, row) => sum + row.total, 0);
	const present = monthRows.reduce((sum, row) => sum + row.present, 0);
	const absent = monthRows.reduce((sum, row) => sum + row.absent, 0);
	return {
		year,
		overall: {
			total,
			present,
			absent,
			pct: total ? Math.round((present / total) * 100) : 0,
			monthsCount: monthRows.filter((row) => row.total).length,
		},
		months: monthRows,
	};
}
